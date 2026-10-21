export const CHUNK_SIZE = 120;

export const chunkPayload = (payloadString) => {
  const totalChunks = Math.ceil(payloadString.length / CHUNK_SIZE);
  const chunks = [];
  const sessionId = Math.floor(Math.random() * 9000 + 1000); // 4-digit session ID

  for (let i = 0; i < totalChunks; i++) {
    const slice = payloadString.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    // Format: SESSION_ID:INDEX:TOTAL:DATA
    chunks.push(`${sessionId}:${i}:${totalChunks}:${slice}`);
  }
  return chunks;
};

export class ChunkCollector {
  constructor() {
    this.buffers = {};
  }

  processChunk(rawChunk) {
    const parts = rawChunk.split(':');
    if (parts.length < 4) return null;

    const sessionId = parts[0];
    const index = parseInt(parts[1], 10);
    const total = parseInt(parts[2], 10);
    const data = parts.slice(3).join(':');

    if (!this.buffers[sessionId]) {
      this.buffers[sessionId] = { total, received: {}, count: 0 };
    }

    const session = this.buffers[sessionId];
    if (!session.received[index]) {
      session.received[index] = data;
      session.count++;
    }

    if (session.count === session.total) {
      let fullPayload = '';
      for (let i = 0; i < session.total; i++) {
        fullPayload += session.received[i];
      }
      delete this.buffers[sessionId];
      return fullPayload;
    }
    return null;
  }
}