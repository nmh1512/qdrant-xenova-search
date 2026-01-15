require('dotenv').config();
const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');
const { client, COLLECTION_NAME, initCollection } = require('./qdrant');
const { generateEmbedding } = require('./embedding');
const { ingest, getLastIdFromQdrant, getMaxIdFromMysql } = require('./ingest');
const constants = require('./constants.json');

// MySQL Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

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
    if (salary) mustFilters.push({ key: 'salary', match: { value: parseInt(salary) } });
    if (experience) mustFilters.push({ key: 'experience', match: { value: parseInt(experience) } });
    if (level) mustFilters.push({ key: 'level', match: { value: parseInt(level) } });
    if (gender) mustFilters.push({ key: 'gender', match: { value: parseInt(gender) } });
    
    // Ngành nghề (Professions)
    if (professions) {
        if (Array.isArray(professions)) {
            const anyOf = professions.map(v => parseInt(v));
            mustFilters.push({ key: 'professions', match: { any: anyOf } });
        } else {
            mustFilters.push({ key: 'professions', match: { value: parseInt(professions) } });
        }
    }

    const filter = mustFilters.length > 0 ? { must: mustFilters } : undefined;

    try {
        let searchResults = [];
        
        if (query) {
            const queryVector = await generateEmbedding(query);
            // MULTI-VECTOR SEARCH: Fusing 'position' and 'content' for better prioritization
            const qdrantResults = await client.query(COLLECTION_NAME, {
                prefetch: [
                    { 
                        query: queryVector,
                        using: 'position', 
                        filter: filter,
                        limit: 100
                    },
                    { 
                        query: queryVector,
                        using: 'content', 
                        filter: filter,
                        limit: 100
                    }
                ],
                query: {
                    fusion: 'rrf',
                },
                limit: 30,
                with_payload: true
            });

            if (qdrantResults && qdrantResults.points && qdrantResults.points.length > 0) {
                const userIds = qdrantResults.points.map(r => r.id);
                
                const [mysqlRows] = await pool.query(`
                    SELECT 
                        u.id, u.name, u.photo, u.about,
                        uc.position, uc.skills, uc.skill_content
                    FROM users u
                    INNER JOIN user_candidates uc ON u.id = uc.user_id
                    WHERE u.id IN (?)
                `, [userIds]);

                const mysqlDataMap = mysqlRows.reduce((acc, row) => {
                    acc[row.id] = row;
                    return acc;
                }, {});
                // Combine Qdrant score/payload with MySQL fresh data
                searchResults = qdrantResults.points.map(r => ({
                    ...r,
                    dbData: mysqlDataMap[r.id]
                })).filter(r => r.dbData); // Filter out any that might have been deleted from DB but exist in Qdrant
            }
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
