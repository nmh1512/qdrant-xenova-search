const { pipeline } = require('@xenova/transformers');

let embedder = null;
let rewriter = null;

async function getEmbedder() {
    if (!embedder) {
        embedder = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
    }
    return embedder;
}

/**
 * Generate embedding for a given text
 * @param {string} text 
 * @returns {Promise<number[]>}
 */
async function generateEmbedding(text) {
    const extractor = await getEmbedder();
    const output = await extractor(text, {
        pooling: 'mean',
        normalize: true,
    });
    return Array.from(output.data);
}

module.exports = { generateEmbedding };
