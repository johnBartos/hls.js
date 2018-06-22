export default class ProgressiveLoader {
  constructor (context, callbacks) {
    this.callbacks = callbacks;
    this.context = context;
    this.request = null;
    this.abortFlag = null;
    this.pump = null;
  }

  load () {
    console.log('>>> loading new frag');
    const { url } = this.context;
    const initParams = {
      method: 'GET',
      mode: 'cors',
      credentials: 'same-origin'
    };

    this.request = window.fetch(url, new window.Request(url, initParams))
      .then(response => {
        if (response.ok) {
          const pump = this.pump = this._createStream(response);
          this.pump = pump;
          return pump;
        }
      });
  }

  stream () {
    console.log('>>> streaming frag')
    const request = this.request;
    if (this.pump) {
      this.pump();
    } else if (this.request) {
      request.then(pump => {
        pump();
      });
    }
  }

  abort () {
    this.abortFlag = true;
  }

  _createStream (response) {
    const { onProgress, onSuccess } = this.callbacks;
    const reader = response.body.getReader();
    let size = 0;
    const pump = () => {
      if (this.abortFlag) {
        console.warn('>>> progressive loader aborted');
        this.callbacks.onAbort();
        reader.cancel();
        return;
      }
      reader.read().then(({ done, value }) => {
        if (done) {
          const response = {
            byteLength: size,
            payload: null
          };
          const stats = {};
          onSuccess(response, stats, this.context);
          return;
        }
        size += value.length;
        onProgress({ size }, this.context, value);
        pump();
      });
    };

    return pump;
  }
}
