export class WorkspaceMutationQueue {
  private readonly tails = new Map<string, Promise<void>>()

  public enqueue<T>(
    workspaceId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.tails.get(workspaceId) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(operation)
    const tail = result.then(
      () => undefined,
      () => undefined,
    )

    this.tails.set(workspaceId, tail)
    void tail.finally(() => {
      if (this.tails.get(workspaceId) === tail) {
        this.tails.delete(workspaceId)
      }
    })

    return result
  }
}
