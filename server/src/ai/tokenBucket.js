class TokenBucket {
  constructor({ capacity, refillPerSec, now = () => Date.now() }) {
    this.capacity = Math.max(0, Number(capacity) || 0);
    this.refillPerSec = Math.max(0, Number(refillPerSec) || 0);
    this.tokens = this.capacity;
    this.lastRefillMs = now();
    this.now = now;
  }

  refill() {
    if (this.refillPerSec <= 0) return;
    const nowMs = this.now();
    const elapsedSec = (nowMs - this.lastRefillMs) / 1000;
    if (elapsedSec <= 0) return;
    this.lastRefillMs = nowMs;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
  }

  tryConsume(count = 1) {
    const n = Math.max(0, Number(count) || 0);
    this.refill();
    if (this.tokens + 1e-9 < n) return false;
    this.tokens -= n;
    return true;
  }

  refund(count = 1) {
    const n = Math.max(0, Number(count) || 0);
    this.refill();
    this.tokens = Math.min(this.capacity, this.tokens + n);
  }
}

module.exports = { TokenBucket };

