const { pipeline } = require('@xenova/transformers');

let embedder = null;
let rewriter = null;

async function getEmbedder() {
    if (!embedder) {
        embedder = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', {
            device: 'cuda'
        });
    }
    return embedder;
}

async function getRewriter() {
    if (!rewriter) {
        rewriter = await pipeline('text2text-generation', 'Xenova/LaMini-Flan-T5-248M', {
            device: 'cuda'
        });
    }
    return rewriter;
}

/**
 * Expand a short query into a rich semantic description
 * Example: "Backend dev" -> "A developer specialized in server-side technologies like PHP, Java, Python..."
 */
async function expandQuery(query) {
    // Nếu query đã dài và đủ ngữ cảnh, không cần expand
    if (query.split(' ').length > 8) return query;

    try {
        const generator = await getRewriter();
        const prompt = `
        Expand the job search query into a SHORT list of RELATED SKILLS.
Rules:
- Only include common skills.
- Do NOT invent rare technologies.
- Output a comma-separated list.
Query: "${query}"`;
        
        const output = await generator(prompt, {
            max_new_tokens: 50,
            temperature: 0.7,
            repetition_penalty: 1.2
        });

        const expanded = output[0].generated_text;
        console.log(`🔍 Expanded Query: "${query}" -> "${expanded}"`);
        // Kết hợp cả query gốc và bản mở rộng để tối ưu search
        return `${query}. ${expanded}`;
    } catch (e) {
        console.warn('⚠️ Expand Query failed, using original:', e.message);
        return query;
    }
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

module.exports = { generateEmbedding, expandQuery };
