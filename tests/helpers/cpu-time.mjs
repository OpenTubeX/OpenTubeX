/**
 * Returns the CPU time this thread has used, in milliseconds.
 *
 * Wall-clock budgets fail whenever the parallel test runner or other load
 * deschedules this process; CPU time on this thread counts only the work done.
 * @returns {number}
 */
export function threadCpuMilliseconds() {
  const { user, system } = process.threadCpuUsage()
  return (user + system) / 1000
}
