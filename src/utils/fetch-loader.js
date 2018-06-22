/**
 * Fetch based loader
 * timeout / abort / onprogress not supported for now
 * timeout / abort : some ideas here : https://github.com/whatwg/fetch/issues/20#issuecomment-196113354
 * but still it is not bullet proof as it fails to avoid data waste....
*/

const { Request, Headers, fetch, performance } = window;

class FetchLoader {
  constructor (config) {
    this.fetchSetup = config.fetchSetup;
  }

  destroy () {}

  abort () {}

  load (context, config, callbacks) {
    let stats = {
      trequest: performance.now(),
      retry: 0
    };

    let targetURL = context.url;
    let fetchPromise = createFetch(targetURL, context, this.fetchSetup);
    // process fetchPromise
    let responsePromise = fetchPromise.then(function (response) {
      if (response.ok) {
        stats.tfirst = Math.max(stats.trequest, performance.now());
        targetURL = response.url;
        if (context.responseType === 'arraybuffer') {
          return response.arrayBuffer();
        } else {
          return response.text();
        }
      } else {
        callbacks.onError({ text: 'fetch, bad network response' }, context);
      }
    }).catch(function (error) {
      callbacks.onError({ text: error.message }, context);
    });

    responsePromise.then(function (responseData) {
      if (responseData) {
        stats.tload = Math.max(stats.tfirst, performance.now());
        let len;
        if (typeof responseData === 'string') {
          len = responseData.length;
        } else {
          len = responseData.byteLength;
        }

        stats.loaded = stats.total = len;
        let response = { url: targetURL, data: responseData };
        callbacks.onSuccess(response, stats, context);
      }
    });
  }

  progressiveLoad (context, config, callbacks) {
    const targetUrl = context.url;
    return createFetch(targetUrl, context, this.fetchSetup)
      .then(response => {
        if (response.ok) {
          return createStream(response, callbacks.onProgress, callbacks.onSuccess, context);
        }
      });
  }
}

function createFetch (url, context, fetchSetup) {
  let request;

  const initParams = {
    method: 'GET',
    mode: 'cors',
    credentials: 'same-origin'
  };

  const headersObj = {};

  if (context.rangeEnd) {
    headersObj['Range'] = 'bytes=' + context.rangeStart + '-' + String(context.rangeEnd - 1);
  }

  initParams.headers = new Headers(headersObj);

  if (fetchSetup) {
    request = fetchSetup(context, initParams);
  } else {
    request = new Request(context.url, initParams);
  }

  return fetch(request, initParams);
}

function createStream (response, onProgress, onComplete, context) {
  let size = 0;
  let abortFlag = false;
  const reader = response.body.getReader();
  const pump = () => {
    if (abortFlag) {
      return;
    }
    reader.read().then(({ done, value }) => {
      if (abortFlag) {
        return;
      }
      if (done) {
        const response = {
          byteLength: size,
          payload: null
        };
        const stats = {};
        onComplete(response, stats, context);
        return;
      }
      size += value.length;
      onProgress({ size }, context, value);
      pump();
    });
  };

  const abort = () => {
    console.warn('>>> progressive loader aborted');
    abortFlag = true;
    reader.cancel();
  };
  return { abort, pump };
}

export default FetchLoader;
