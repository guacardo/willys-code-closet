export class Inbox<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private waiter: (() => void) | null = null
  private closed = false

  push(item: T) {
    if (this.closed) return
    this.queue.push(item)
    this.waiter?.()
  }

  close() {
    this.closed = true
    this.waiter?.()
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.queue.length) {
        yield this.queue.shift() as T
        continue
      }
      if (this.closed) return
      await new Promise<void>((resolve) => (this.waiter = resolve))
      this.waiter = null
    }
  }
}
