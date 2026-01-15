const { QdrantClient } = require('@qdrant/js-client-rest');

// Qdrant service is usually available at 'qdrant' inside docker-compose network
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION_NAME = 'docs';

const client = new QdrantClient({ url: QDRANT_URL });

async function initCollection() {
    let retries = 5;
    while (retries > 0) {
        try {
            const collections = await client.getCollections();
            const exists = collections.collections.some(c => c.name === COLLECTION_NAME);

            if (!exists) {
                console.log(`Creating collection: ${COLLECTION_NAME}`);
                await client.createCollection(COLLECTION_NAME, {
                    vectors: {
                        position: { size: 384, distance: 'Cosine', on_disk: true },
                        content: { size: 384, distance: 'Cosine', on_disk: true }
                    },
                    hnsw_config: {
                        m: 16,
                        ef_construct: 100,
                        on_disk: true // Use mmap for index to handle large scale
                    },
                    quantization_config: {
                        scalar: {
                            type: 'int8',
                            quantile: 0.99,
                            always_ram: true // Keep quantized vectors in RAM for speed
                        }
                    },
                    optimizers_config: {
                        memmap_threshold: 20000 // Move to disk earlier
                    }
                });
            }

            await ensureIndexes();
            return; 
        } catch (error) {
            retries--;
            console.error(`⚠️ Qdrant initialization error (${retries} retries left):`, error.message);
            if (retries === 0) throw error;
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
}

async function ensureIndexes() {
    const fields = [
        { name: 'city_id', schema: 'keyword' },
        { name: 'salary', schema: 'keyword' },
        { name: 'experience', schema: 'keyword' },
        { name: 'gender', schema: 'keyword' },
        { name: 'work_type', schema: 'keyword' },
        { name: 'level', schema: 'keyword' },
        { name: 'professions', schema: 'keyword' }
    ];

    for (const field of fields) {
        try {
            await client.createPayloadIndex(COLLECTION_NAME, {
                field_name: field.name,
                field_schema: field.schema,
                wait: true
            });
        } catch (e) {
        }
    }
}

module.exports = {
    client,
    COLLECTION_NAME,
    initCollection
};
