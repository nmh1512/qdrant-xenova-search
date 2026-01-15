const { pipeline } = require('@xenova/transformers');

async function download() {
    console.log('Pre-downloading embedding model...');
    await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
    
    console.log('Models downloaded successfully!');
}

download();
