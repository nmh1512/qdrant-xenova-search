require('dotenv').config();
const mysql = require('mysql2/promise');
const { client, COLLECTION_NAME, initCollection } = require('./qdrant');
const { generateEmbedding } = require('./embedding');
const constants = require('./constants.json');

async function getMysqlConnection() {
    return await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 3306
    });
}

/**
 * Lấy ID lớn nhất hiện tại trong MySQL
 */
async function getMaxIdFromMysql() {
    let connection;
    try {
        connection = await getMysqlConnection();
        const [rows] = await connection.execute('SELECT MAX(user_id) as maxId FROM user_candidates');
        return rows[0].maxId || 0;
    } catch (e) {
        console.error('❌ Lỗi khi lấy Max ID từ MySQL:', e.message);
        return 0;
    } finally {
        if (connection) await connection.end();
    }
}

/**
 * Optimally fetch and combine candidate data
 */
/**
 * Fetch a batch of candidates using multi-stage queries (efficient for millions of records)
 */
async function fetchBatch(connection, lastId, batchSize = 1000) {
    // 1. Fetch Core data only (users + user_candidates)
    const [mainRows] = await connection.execute(`
        SELECT 
            u.id, u.name, u.photo, u.about, uc.address, u.gender_id as gender,
            uc.position, uc.skills, uc.skill_content, uc.experience
        FROM users u
        INNER JOIN user_candidates uc ON u.id = uc.user_id
        WHERE u.deleted_at IS NULL AND u.id > ?
        ORDER BY u.id ASC
        LIMIT ?
    `, [lastId, batchSize]);

    if (mainRows.length === 0) return [];

    const userIds = mainRows.map(r => r.id);
    const placeholders = userIds.map(() => '?').join(',');

    const [findworkRows] = await connection.execute(
        `SELECT user_id, address as city_ids, salary, professions, work_types, rank as level FROM user_findworks WHERE user_id IN (${placeholders})`,
        userIds
    );
    
    const findworkMap = {};
    findworkRows.forEach(r => findworkMap[r.user_id] = r);

    return mainRows.map(row => {
        const findwork = findworkMap[row.id] || {};
        return {
            ...row,
            city_ids: findwork.city_ids,
            salary: findwork.salary,
            professions: findwork.professions,
            work_types: findwork.work_types,
            level: findwork.level
        };
    });
}


/**
 * Construct a rich text representation for semantic search
 */
/**
 * Helper to map a comma-separated list of IDs to labels
 */
function mapIdList(csv, map) {
    if (!csv) return '';
    return csv.split(',')
        .map(id => id.trim())
        .map(id => map[id] || id) // Use label if found, else keep ID
        .filter(Boolean)
        .join(', ');
}

/**
 * Construct a rich text representation for semantic search
 * Focus ONLY on natural language and semantic content.
 */
function createSearchableText(doc) {
    const mappedSkills = mapIdList(doc.skills, constants.skillsMap);

    const parts = [
        doc.position,
        doc.about,
        doc.skill_content,
        mappedSkills ? `Kỹ năng: ${mappedSkills}` : ''
    ].filter(Boolean);
    
    // Use natural separators (.) and keep it clean for the paraphrase model
    return parts.join('. ').substring(0, 1000);
}

/**
 * Automatically find the highest ID in Qdrant using binary search (efficient)
 */
async function getLastIdFromQdrant() {
    try {
        const info = await client.getCollection(COLLECTION_NAME);
        if (info.points_count === 0) return 0;

        console.log(`🔍 Qdrant đang có ~${info.points_count} bản ghi. Đang tìm vị trí cuối cùng...`);
        
        let low = 0;
        let high = 2000000; 
        let lastId = 0;

        while (low <= high) {
            let mid = Math.floor((low + high) / 2);
            const result = await client.scroll(COLLECTION_NAME, {
                offset: mid,
                limit: 1,
                with_payload: false
            });

            if (result.points.length > 0) {
                lastId = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        // Get the exact max ID from the last small segment
        const finalScroll = await client.scroll(COLLECTION_NAME, {
            offset: lastId,
            limit: 100,
            with_payload: false
        });

        if (finalScroll.points.length > 0) {
            return Math.max(...finalScroll.points.map(p => parseInt(p.id)));
        }
        return lastId;
    } catch (e) {
        console.log('⚠️ Không thể kiểm tra ID cũ (có thể collection chưa tạo).');
        return 0;
    }
}

async function ingest() {
    let connection;
    try {
        await initCollection();
        connection = await getMysqlConnection();
        
        const [qdrantLastId, mysqlMaxId] = await Promise.all([
            getLastIdFromQdrant(),
            getMaxIdFromMysql()
        ]);

        let lastId = parseInt(process.env.START_ID) || qdrantLastId;
        const BATCH_SIZE = 100; 
        
        if (lastId >= mysqlMaxId && !process.env.START_ID) {
            console.log(`✅ Dữ liệu đã đồng bộ hoàn tất (Last ID: ${lastId} >= Max MySQL ID: ${mysqlMaxId}).`);
            return;
        }

        console.log(`🚀 Bắt đầu đồng bộ: Từ ID ${lastId} đến ${mysqlMaxId}...`);

        let totalProcessed = 0;
        // Chạy cho đến khi không còn dữ liệu hoặc vượt quá maxId thực tế
        while (lastId < mysqlMaxId) {
            // 1. Fetch Batch từ MySQL
            const candidates = await fetchBatch(connection, lastId, BATCH_SIZE);
            
            if (candidates.length === 0) {
                console.log('🏁 No more records found. Ingestion complete.');
                break;
            }

            console.log(`\n📦 Processing batch: ${candidates.length} records (Last ID: ${lastId})...`);

            // 2. Generate Embeddings & Prepare for Qdrant
            const points = [];
            for (const doc of candidates) {
                try {
                    const textToEmbed = createSearchableText(doc);
                    if (textToEmbed.length < 5) continue; 

                    const vector = await generateEmbedding(textToEmbed);

                    points.push({
                        id: doc.id,
                        vector: vector,
                        payload: {
                            userId: doc.id,
                            name: doc.name,
                            photo: doc.photo,
                            address: doc.address,
                            city_id: doc.city_ids ? doc.city_ids.toString().split(',').map(v => parseInt(v.trim())).filter(v => !isNaN(v)) : [],
                            salary: doc.salary,
                            experience: doc.experience,
                            gender: doc.gender,        
                            level: doc.level,         
                            work_type: doc.work_types ? doc.work_types.toString().split(',').map(v => parseInt(v.trim())).filter(v => !isNaN(v)) : [], 
                            professions: doc.professions ? doc.professions.toString().split(',').map(v => parseInt(v.trim())).filter(v => !isNaN(v)) : [], 
                            content: textToEmbed // Store full text for keyword matching
                        }
                    });
                } catch (err) {
                    console.error(`⚠️ Error embedding User ID ${doc.id}:`, err.message);
                }
            }

            // 3. Upsert to Qdrant with RETRY logic
            if (points.length > 0) {
                let retries = 3;
                while (retries > 0) {
                    try {
                        await client.upsert(COLLECTION_NAME, {
                            wait: false, 
                            points: points
                        });
                        break; // Success
                    } catch (err) {
                        retries--;
                        console.error(`❌ Upsert failed (Retries left: ${retries}):`, err.message);
                        if (retries === 0) throw err;
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
                    }
                }
            }

            // 4. Update Pagination Cursor
            lastId = candidates[candidates.length - 1].id;
            totalProcessed += candidates.length;
            
            console.log(`✅ Synced ${points.length} points. Last ID: ${lastId} / Target: ${mysqlMaxId}`);
            
            // 5. Small throttler to avoid saturating connection
            await new Promise(resolve => setTimeout(resolve, 100)); 
        }

        console.log(`\n🎉 Ingestion Finished! Total processed: ${totalProcessed}`);

    } catch (error) {
        console.error('❌ Critical Ingestion Error:', error);
    } finally {
        if (connection) await connection.end();
    }
}

if (require.main === module) {
    ingest();
}

module.exports = { ingest, getLastIdFromQdrant, getMaxIdFromMysql };
