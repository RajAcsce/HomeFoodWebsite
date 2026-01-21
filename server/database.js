const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'home_food_data.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

const defaultData = {
    admins: [],
    users: [],
    products: [],
    orders: [],
    order_items: [],
    payments: [],
    business_info: []
};

class JSONDatabase {
    constructor() {
        this.data = defaultData;
        this.load();
    }

    load() {
        if (fs.existsSync(DATA_FILE)) {
            try {
                const raw = fs.readFileSync(DATA_FILE, 'utf8');
                const loaded = JSON.parse(raw);
                this.data = { ...defaultData, ...loaded };
            } catch (e) {
                console.error("Error reading data file, using defaults:", e);
                this.data = { ...defaultData };
            }
        } else {
            this.save();
        }
    }

    save() {
        fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2));
    }

    // --- CRUD Operations ---

    // Find all items in a collection, optionally filtered
    findAll(collection, predicate = null) {
        const list = this.data[collection] || [];
        if (predicate) return list.filter(predicate);
        return list;
    }

    // Find a single item
    findOne(collection, predicate) {
        return (this.data[collection] || []).find(predicate);
    }

    // Insert an item
    insert(collection, item) {
        if (!this.data[collection]) this.data[collection] = [];

        // Auto-increment ID if not provided (and not users table which uses mobile)
        if (!item.id && collection !== 'users') {
            const maxId = this.data[collection].reduce((max, i) => Math.max(max, i.id || 0), 0);
            item.id = maxId + 1;
        }

        // Add timestamps
        if (!item.created_at) item.created_at = new Date().toISOString();

        this.data[collection].push(item);
        this.save();
        return item;
    }

    // Update items
    update(collection, predicate, updates) {
        const list = this.data[collection] || [];
        const item = list.find(predicate);
        if (item) {
            Object.assign(item, updates);
            this.save();
            return item; // Return updated item
        }
        return null;
    }

    // Delete items
    delete(collection, predicate) {
        if (!this.data[collection]) return false;
        const initialLen = this.data[collection].length;
        this.data[collection] = this.data[collection].filter(item => !predicate(item));
        const changed = this.data[collection].length !== initialLen;
        if (changed) this.save();
        return changed; // Return true if something was deleted
    }

    // Special helper for getting the latest business info
    getBusinessInfo() {
        const list = this.data.business_info || [];
        return list.length > 0 ? list[list.length - 1] : {}; // Return last entry
    }
}

// Export a singleton instance
module.exports = new JSONDatabase();
