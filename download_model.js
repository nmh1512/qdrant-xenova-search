const { pipeline } = require('@xenova/transformers');

async function download() {
    console.log('Pre-downloading embedding model...');
    await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
    
    console.log('Pre-downloading rewrite model (LaMini)...');
    await pipeline('text2text-generation', 'Xenova/LaMini-Flan-T5-248M');
    
    console.log('Models downloaded successfully!');
}

download();
