const App = (() => {
    const API_BASE = '/api';

    // State
    let currentUser = null;
    let isAdmin = false;

    // API Helper
    async function request(endpoint, method = 'GET', data = null) {
        const options = { method };
        if (data instanceof FormData) {
            options.body = data;
        } else {
            options.headers = { 'Content-Type': 'application/json' };
            if (data) options.body = JSON.stringify(data);
        }

        try {
            const res = await fetch(`${API_BASE}${endpoint}`, options);
            const text = await res.text();
            let json;
            try {
                json = JSON.parse(text);
            } catch (e) {
                console.error("Invalid JSON Response:", text);
                throw new Error(`Server returned invalid response (Status: ${res.status})`);
            }
            if (!res.ok) throw new Error(json.error || 'Request failed');
            return json;
        } catch (err) {
            showToast(err.message, 'error');
            throw err;
        }
    }

    // Toast Notification
    function showToast(message, type = 'info', position = 'left') {
        const toast = document.createElement('div');
        toast.className = `toast ${type} toast-left`;
        toast.textContent = message;
        toast.style.color = '#000'; // Black text
        toast.style.backgroundColor = type === 'error' ? '#f8d7da' : '#d4edda';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    // Format Currency
    function formatCurrency(amount) {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR'
        }).format(amount);
    }

    // View Switcher (Top Level)
    function showView(viewId) {
        document.querySelectorAll('.view').forEach(el => el.style.display = 'none');
        const target = document.getElementById(viewId);
        if (target) target.style.display = 'block';
    }

    // Tab Switcher (Nested)
    function showTab(tabId, tabClass) {
        document.querySelectorAll('.' + tabClass).forEach(el => el.style.display = 'none');
        const target = document.getElementById(tabId);
        if (target) target.style.display = 'block';
    }

    return {
        request,
        showToast,
        formatCurrency,
        showView,
        showTab,
        state: {
            get user() { return currentUser; },
            set user(val) { currentUser = val; },
            get isAdmin() { return isAdmin; },
            set isAdmin(val) { isAdmin = val; }
        }
    };
})();
