// Bridge-disconnect watchdog (dashboard-self-restart-safety, Wave 4): the existing systemd unit
// (`Restart=on-failure`) only sees crash-only failures — the process dies, systemd restarts it.
// This covers the OTHER failure mode: the process stays alive, but its tunnel to the live relay
// has been down for too long, which a crash-only supervisor can never notice. This module is the
// pure decision at the heart of it, no I/O of any kind, so it's unit-testable in total isolation —
// see ops/claudstermind-watchdog.sh for the script that actually gathers the numbers and calls it.
export function shouldRestartForDisconnect({ secondsSinceLastHeartbeat, processUptimeSeconds, gracePeriodSeconds }) {
  // A process still inside its own boot grace period gets a pass regardless of "disconnect"
  // duration — it hasn't had time to establish its first connection yet, so restarting it now
  // would restart-loop a process that never gets the chance to connect in the first place.
  if (processUptimeSeconds < gracePeriodSeconds) return false;
  return secondsSinceLastHeartbeat > gracePeriodSeconds;
}
