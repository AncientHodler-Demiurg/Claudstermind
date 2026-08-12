// Test-only side-effect module: clear SESSIOND_SOCK before importing dashboard/server.mjs.
//
// Now that the sessiond daemon can be installed, SESSIOND_SOCK is set in the live service env, and a
// test process launched through that service inherits it. dashboard/server.mjs selects its engine at
// module load: with SESSIOND_SOCK set it AWAITs a real connection to the live daemon (open socket +
// reconnect timers) — which hangs the test process. Import THIS first (before ./server.mjs) so the
// deletion happens before that selection runs; the test then takes the deterministic in-process path.
delete process.env.SESSIOND_SOCK;
