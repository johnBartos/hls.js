/*
 * Fragment Loader
*/

import Event from '../events';
import EventHandler from '../event-handler';
import { ErrorTypes, ErrorDetails } from '../errors';
import { logger } from '../utils/logger';

class FragmentLoader extends EventHandler {
  constructor (hls) {
    super(hls, Event.FRAG_LOADING, Event.FRAG_LOADING_PROGRESSIVE, Event.FRAG_LOAD_ABORT);
    const config = this.config = hls.config;
    this.loaders = {};
    this.requestQueue = [];
    this.loaderCallbacks = {
      onSuccess: this.loadsuccess.bind(this),
      onError: this.loaderror.bind(this),
      onTimeout: this.loadtimeout.bind(this),
      onProgress: this.loadprogress.bind(this)
    };
    this.loaderConfig = {
      timeout: config.fragLoadingTimeOut,
      maxRetry: 0,
      retryDelay: 0,
      maxRetryDelay: config.fragLoadingMaxRetryTimeout
    };

    if (config.lowLatency) {
      this.progressiveLoader = new config.loader(hls);
    }
  }

  destroy () {
    let loaders = this.loaders;
    for (let loaderName in loaders) {
      let loader = loaders[loaderName];
      if (loader) {
        loader.destroy();
      }
    }
    this.loaders = {};

    super.destroy();
  }

  onFragLoading (data) {
    const { config, loaderCallbacks, loaderConfig, loaders } = this;
    const frag = data.frag;
    const type = frag.type;
    const FragmentILoader = config.fLoader;
    const DefaultILoader = config.loader;

    // reset fragment state
    frag.loaded = 0;

    let loader = loaders[type];
    if (loader) {
      logger.warn(`abort previous fragment loader for type: ${type}`);
      loader.abort();
    }

    loader = loaders[type] = frag.loader =
      config.fLoader ? new FragmentILoader(config) : new DefaultILoader(config);

    const loaderContext = { url: frag.url, frag: frag, responseType: 'arraybuffer', progressData: false };
    const start = frag.byteRangeStartOffset;
    const end = frag.byteRangeEndOffset;

    if (!isNaN(start) && !isNaN(end)) {
      loaderContext.rangeStart = start;
      loaderContext.rangeEnd = end;
    }

    loader.load(loaderContext, loaderConfig, loaderCallbacks);
  }

  onFragLoadingProgressive (data) {
    console.log('>>> loading');
    const { loaderCallbacks, loaderConfig, progressiveLoader, requestQueue } = this;
    const frag = data.frag;

    if (requestQueue.length) {
      return;
    }

    const loaderContext = { url: frag.url, frag, responseType: 'arraybuffer' };
    requestQueue.push(progressiveLoader.progressiveLoad(loaderContext, loaderConfig, loaderCallbacks));
    if (requestQueue.length === 1) {
      this._checkQueue();
    }
  }

  onFragLoadAbort () {
    this.requestQueue.forEach(p => {
      p.then(({ pump, abort }) => {
        abort();
      });
    });
  }

  loadsuccess (response, stats, context, networkDetails = null) {
    let payload = response.data, frag = context.frag;
    // detach fragment loader on load success
    frag.loader = null;
    this.loaders[frag.type] = null;
    this.hls.trigger(Event.FRAG_LOADED, { payload: payload, frag: frag, stats: stats, networkDetails: networkDetails });

    if (this.hls.config.lowLatency) {
      this.requestQueue.pop();
      this._checkQueue();
    }
  }

  loaderror (response, context, networkDetails = null) {
    let loader = context.loader;
    if (loader) {
      loader.abort();
    }

    this.loaders[context.type] = undefined;
    this.hls.trigger(Event.ERROR, { type: ErrorTypes.NETWORK_ERROR, details: ErrorDetails.FRAG_LOAD_ERROR, fatal: false, frag: context.frag, response: response, networkDetails: networkDetails });
  }

  loadtimeout (stats, context, networkDetails = null) {
    let loader = context.loader;
    if (loader) {
      loader.abort();
    }

    this.loaders[context.type] = undefined;
    this.hls.trigger(Event.ERROR, { type: ErrorTypes.NETWORK_ERROR, details: ErrorDetails.FRAG_LOAD_TIMEOUT, fatal: false, frag: context.frag, networkDetails: networkDetails });
  }

  // data will be used for progressive parsing
  loadprogress (stats, context, data, networkDetails = null) { // jshint ignore:line
    let frag = context.frag;
    frag.loaded = stats.loaded;
    this.hls.trigger(Event.FRAG_LOAD_PROGRESS, { frag: frag, stats: stats, networkDetails: networkDetails, payload: data });
  }

  _checkQueue () {
    console.log('>>> checking queue', this.requestQueue.length);
    const queue = this.requestQueue;
    const startPromise = queue[0];
    if (startPromise) {
      startPromise.then(controller => controller.pump());
    }
  }
}

export default FragmentLoader;
