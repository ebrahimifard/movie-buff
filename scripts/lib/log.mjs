// Shared timestamp + memory-usage logging for the data pipeline scripts.
// Added after a real OOM kill during enrich-tmdb.mjs's TMDB enrichment pass
// left no trail of how far the process got or whether memory was climbing
// beforehand — every pipeline script's run() should log at least a start and
// completion line through this, so a kill anywhere in the chain leaves a
// diagnosable trace instead of silence.
export function formatMemoryUsage() {
  const { rss, heapUsed } = process.memoryUsage();
  return `rss=${Math.round(rss / 1024 / 1024)}MB heapUsed=${Math.round(heapUsed / 1024 / 1024)}MB`;
}

export function logStep(message) {
  console.log(`[${new Date().toISOString()}] ${message} (${formatMemoryUsage()})`);
}
