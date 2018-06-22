/*
 * Fragment Loader
*/

import Event from '../events';
import EventHandler from '../event-handler';
import { ErrorTypes, ErrorDetails } from '../errors';
import { logger } from '../utils/logger';
import ProgressiveLoader from './progressive-loader';

class FragmentLoader extends EventHandler {
  constructor (hls) {
    super(hls, Event.FRAG_LOADING, Event.FRAG_LOADING_PROGRESSIVE);
    const config = this.config = hls.config;
    this.loaders = {};
    this.requestQueue = [];
    this.loaderCallbacks = {
      onSuccess: this.loadsuccess.bind(this),
      onError: this.loaderror.bind(this),
      onTimeout: this.loadtimeout.bind(this),
      onProgress: this.loadprogress.bind(this),
      onAbort: this.loadAbort.bind(this)
    };
    this.loaderConfig = {
      timeout: config.fragLoadingTimeOut,
      maxRetry: 0,
      retryDelay: 0,
      maxRetryDelay: config.fragLoadingMaxRetryTimeout
    };
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

    if (Number.isFinite(start) && Number.isFinite(end)) {
      loaderContext.rangeStart = start;
      loaderContext.rangeEnd = end;
    }

    loader.load(loaderContext, loaderConfig, loaderCallbacks);
  }

  onFragLoadingProgressive (data) {
    console.log('>>> loading');
    const { loaderCallbacks, requestQueue } = this;
    const frag = data.frag;

    const loaderContext = { url: frag.url, frag, responseType: 'arraybuffer' };
    const loader = frag.loader = new ProgressiveLoader(loaderContext, loaderCallbacks);
    // Start downloading the fragment. This doesn't stream the bytes yet
    loader.load();
    requestQueue.push(loader);
    if (requestQueue.length === 1) {
      this._checkQueue();
    }
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
    const frag = context.frag;
    let loader = frag.loader;
    if (loader) {
      loader.abort();
    }

    this.loaders[frag.type] = undefined;
    this.hls.trigger(Event.ERROR, { type: ErrorTypes.NETWORK_ERROR, details: ErrorDetails.FRAG_LOAD_ERROR, fatal: false, frag: context.frag, response: response, networkDetails: networkDetails });
  }

  loadtimeout (stats, context, networkDetails = null) {
    const frag = context.frag;
    let loader = frag.loader;
    if (loader) {
      loader.abort();
    }

    this.loaders[frag.type] = undefined;
    this.hls.trigger(Event.ERROR, { type: ErrorTypes.NETWORK_ERROR, details: ErrorDetails.FRAG_LOAD_TIMEOUT, fatal: false, frag: context.frag, networkDetails: networkDetails });
  }

  // data will be used for progressive parsing
  loadprogress (stats, context, data, networkDetails = null) { // jshint ignore:line
    let frag = context.frag;
    frag.loaded = stats.loaded;
    this.hls.trigger(Event.FRAG_LOAD_PROGRESS, { frag: frag, stats: stats, networkDetails: networkDetails, payload: data });
  }

  loadAbort () {
    console.warn('>>> loader abort callback')
    this.requestQueue.pop();
    this._checkQueue();
    this.hls.trigger(Event.FRAG_LOAD_EMERGENCY_ABORTED);
  }

  _checkQueue () {
    console.log('>>> checking queue', this.requestQueue.length);
    const queue = this.requestQueue;
    const loader = queue[0];
    if (loader) {
      loader.stream();
    }
  }
}

export default FragmentLoader;
