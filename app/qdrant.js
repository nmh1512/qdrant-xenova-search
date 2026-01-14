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
                        size: 384, 
                        distance: 'Cosine',
                    },
                });

                // Create text index for hybrid search (keyword matching)
                await client.createPayloadIndex(COLLECTION_NAME, {
                    field_name: 'content',
                    field_schema: 'text',
                    wait: true
                });
            }
            return; // Success
        } catch (error) {
            retries--;
            console.error(`⚠️ Qdrant chưa sẵn sàng (${retries} lần thử lại còn lại):`, error.message);
            if (retries === 0) throw error;
            await new Promise(resolve => setTimeout(resolve, 3000)); // Chờ 3s trước khi thử lại
        }
    }
}

module.exports = {
    client,
    COLLECTION_NAME,
    initCollection
};
