const { EventEmitter } = require('events');

const emitter = new EventEmitter();
emitter.setMaxListeners(500);

function emitJob(jobId) {
  emitter.emit(`job:${jobId}`, { jobId });
  emitter.emit('job:any', { jobId });
}

function onJob(jobId, handler) {
  emitter.on(`job:${jobId}`, handler);
  return () => emitter.off(`job:${jobId}`, handler);
}

module.exports = { emitJob, onJob };

