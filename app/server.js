require('dotenv').config();
const express = require('express');
const path = require('path');
const { client, COLLECTION_NAME, initCollection } = require('./qdrant');
const { generateEmbedding, expandQuery } = require('./embedding');
const { ingest, getLastIdFromQdrant, getMaxIdFromMysql } = require('./ingest');
const constants = require('./constants.json');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Qdrant and check if we need to ingest data
async function startup() {
    await initCollection();
    
    const [qdrantLastId, mysqlMaxId] = await Promise.all([
        getLastIdFromQdrant(),
        getMaxIdFromMysql()
    ]);

    if (qdrantLastId < mysqlMaxId) {
        console.log(`📊 Trạng thái: Qdrant (${qdrantLastId}) < MySQL (${mysqlMaxId})`);
        console.log('🚀 Đang khởi động đồng bộ dữ liệu còn thiếu (Chạy ngầm)...');
        ingest().catch(err => console.error('Lỗi Ingestion ngầm:', err));
    } else {
        console.log(`✅ Dữ liệu đã đồng bộ hoàn toàn (Last ID: ${qdrantLastId}).`);
    }
}

app.get('/', async (req, res) => {
    res.render('index', { results: null, query: '', filters: {}, constants });
});

app.get('/search', async (req, res) => {
    const query = req.query.q || '';
    const city_id = req.query.city_id;
    const salary = req.query.s;      
    const experience = req.query.e;  
    const work_type = req.query.t;   // Loại hình (t)
    const level = req.query.k;       // Cấp bậc (k)
    const gender = req.query.g;      // Giới tính (g)
    const professions = req.query.c;    // Ngành nghề (c)

    // Build filter array
    const mustFilters = [];
    if (city_id) mustFilters.push({ key: 'city_id', match: { value: parseInt(city_id) } });
    if (work_type) mustFilters.push({ key: 'work_type', match: { value: parseInt(work_type) } });
    
    // Ngành nghề (Professions)
    if (professions) {
        if (Array.isArray(professions)) {
            const anyOf = professions.map(v => parseInt(v));
            mustFilters.push({ key: 'professions', match: { any: anyOf } });
        } else {
            mustFilters.push({ key: 'professions', match: { value: parseInt(professions) } });
        }
    }

    // Build soft filters or additional must filters for specific fields
    // User requested to keep these "soft" or at least not strictly hard if possible, 
    // but for now let's keep them in must if selected, or we can move them to should for a more "relaxed" search.
    // Let's stick to the user's "certain" list for mustFilters.
    const optionalFilters = [];
    if (salary) optionalFilters.push({ key: 'salary', match: { value: parseInt(salary) } });
    if (experience) optionalFilters.push({ key: 'experience', match: { value: parseInt(experience) } });
    if (level) optionalFilters.push({ key: 'level', match: { value: parseInt(level) } });
    if (gender) optionalFilters.push({ key: 'gender', match: { value: parseInt(gender) } });

    const filter = {
        must: mustFilters,
        should: optionalFilters
    };

    try {
        let searchResults = [];
        
        if (query) {
            const expandedText = await expandQuery(query);
            const queryVector = await generateEmbedding(expandedText);
            searchResults = await client.search(COLLECTION_NAME, {
                vector: queryVector,
                filter: {
                    ...filter,
                    should: [
                        ...(filter.should || []),
                        { key: 'content', match: { text: query } } // Keyword match
                    ]
                },
                limit: 30, // Increased candidate pool
                params: {
                    ef: 128 // Better recall
                },
                with_payload: true,
                with_score: true
            });
        } 
      
        res.render('index', { 
            results: searchResults, 
            query: query,
            filters: { city_id, salary, experience, work_type, level, gender, professions },
            constants
        });
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).send('An error occurred during search.');
    }
});

startup().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('Failed to start server:', err);
});
