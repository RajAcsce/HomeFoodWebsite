const Admin = (() => {

    async function init() {
        // Load initial dashboard data
        loadStats();
        setupEventListeners();
    }

    function setupEventListeners() {
        document.getElementById('nav-dashboard').addEventListener('click', () => {
            App.showTab('admin-dashboard', 'admin-tab');
        });
        document.getElementById('nav-revenue').addEventListener('click', () => {
            App.showTab('admin-revenues', 'admin-tab');
            loadRevenuePage();
        });

        // Initialize Date Filters to Current Month
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0); // Correct last day of month
        const monthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

        const mFilter = document.getElementById('revenue-month-filter');
        if (mFilter) mFilter.value = monthStr;

        const sDate = document.getElementById('revenue-start-date');
        if (sDate) sDate.value = firstDay.toISOString().split('T')[0];

        const eDate = document.getElementById('revenue-end-date');
        if (eDate) eDate.value = lastDay.toISOString().split('T')[0];

        // Trigger load
        loadStats();
        Admin.filterRevenueChart(); // Load chart for current month
        document.getElementById('nav-products').addEventListener('click', () => {
            App.showTab('admin-products', 'admin-tab');
            loadProducts();
        });
        document.getElementById('nav-orders').addEventListener('click', () => {
            App.showTab('admin-orders', 'admin-tab');
            loadOrders();
        });
        document.getElementById('nav-business').addEventListener('click', () => {
            App.showTab('admin-business', 'admin-tab');
            loadBusinessProfile();
        });

        // Business Profile Form
        document.getElementById('business-profile-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            try {
                await App.request('/admin/business-profile', 'POST', data);
                App.showToast('Business Profile Updated', 'info', 'left');
                loadBusinessProfile();
            } catch (err) {
                console.error(err);
            }
        });

        // Add/Edit Product Form
        document.getElementById('add-product-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            const formData = new FormData(form);
            const data = Object.fromEntries(formData.entries());
            const mode = form.dataset.mode || 'create';
            const id = form.dataset.id;

            try {
                if (mode === 'edit') {
                    await App.request(`/products/${id}`, 'PUT', data);
                    App.showToast('Product updated successfully', 'info', 'left');

                    // Reset to create mode
                    form.dataset.mode = 'create';
                    delete form.dataset.id;
                    form.querySelector('button[type="submit"]').textContent = 'Add Product';
                    document.querySelector('#admin-products h4').textContent = 'Add New Product';
                } else {
                    await App.request('/products', 'POST', data);
                    App.showToast('Product added successfully', 'info', 'left');
                }
                form.reset();
                loadProducts();
            } catch (err) {
                console.error(err);
            }
        });

        document.getElementById('nav-users').addEventListener('click', () => {
            App.showTab('admin-users', 'admin-tab');
            loadUsers();
        });

        // Dashboard Summary Card Redirections
        document.getElementById('stat-users').parentElement.parentElement.addEventListener('click', () => {
            App.showTab('admin-users', 'admin-tab');
            loadUsers();
        });
        document.getElementById('stat-products').parentElement.parentElement.addEventListener('click', () => {
            App.showTab('admin-products', 'admin-tab');
            loadProducts();
        });
        document.getElementById('stat-orders').parentElement.parentElement.addEventListener('click', () => {
            App.showTab('admin-orders', 'admin-tab');
            loadOrders();
        });
        document.getElementById('stat-revenue').parentElement.parentElement.addEventListener('click', () => {
            App.showTab('admin-revenues', 'admin-tab');
            loadRevenuePage();
        });

        const editUserForm = document.getElementById('edit-user-form');
        if (editUserForm) editUserForm.addEventListener('submit', saveUser);
    }

    let revenueChartInstance = null;
    let statusChartInstance = null;
    let currentTodayOrders = [];

    async function loadStats() {
        try {
            const stats = await App.request('/dashboard/stats');
            document.getElementById('stat-users').textContent = stats.users || 0;
            document.getElementById('stat-orders').textContent = stats.orders || 0;
            document.getElementById('stat-revenue').textContent = App.formatCurrency(stats.revenue || 0);
            document.getElementById('stat-products').textContent = stats.products || 0;

            // Today's orders
            if (document.getElementById('today-orders-count')) {
                document.getElementById('today-orders-count').textContent = stats.today_orders_count || 0;
                document.getElementById('today-revenue').textContent = App.formatCurrency(stats.today_revenue || 0);
                renderTodayOrders(stats.today_orders || []);
            }

            // Initial Revenue Chart Load (using default date values from inputs)
            Admin.filterRevenueChart();
            renderStatusChart(stats.status_chart || []);
        } catch (err) {
            console.error(err);
        }
    }

    function renderTodayOrders(orders) {
        currentTodayOrders = orders;
        const container = document.getElementById('today-orders-list');
        if (!container) return;

        if (orders.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:var(--text-light); padding:20px;">No orders today</p>';
            return;
        }

        const table = document.createElement('table');
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Order ID</th>
                    <th>Customer</th>
                    <th>Amount</th>
                    <th>Delivery Date</th>
                    <th>Delivery Time</th>
                    <th>Status</th>
                    <th>View</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        const tbody = table.querySelector('tbody');

        orders.forEach((o, index) => {
            const tr = document.createElement('tr');

            // Status-based row colors
            let rowBg = '';
            if (o.status === 'Delivered') rowBg = '#d4edda'; // Light green
            else if (o.status === 'Pending') rowBg = '#f8d7da'; // Light red
            else if (o.status === 'Accepted' || o.status === 'Preparing') rowBg = '#fff3cd'; // Light yellow
            else if (o.status === 'Cancelled') rowBg = '#f5c6cb'; // Dark red

            // Format delivery date
            let deliveryDateStr = 'Not Set';
            if (o.delivery_date) {
                const dd = new Date(o.delivery_date);
                deliveryDateStr = dd.toLocaleDateString('en-GB'); // DD/MM/YYYY
            }

            // Format delivery time
            let deliveryTime = o.delivery_slot || 'Not Set';
            if (deliveryTime === 'express') {
                deliveryTime = 'Express (60 mins)';
            }

            tr.style.backgroundColor = rowBg;
            tr.innerHTML = `
                <td>#${o.id}</td>
                <td>${o.user_name || 'N/A'}</td>
                <td>${App.formatCurrency(o.total_amount)}</td>
                <td>${deliveryDateStr}</td>
                <td>${deliveryTime}</td>
                <td>${o.status}</td>
                <td><button class="btn btn-sm btn-secondary" onclick="Admin.viewOrderItemsByIndex(${index})">View Items</button></td>
            `;
            tbody.appendChild(tr);
        });

        container.innerHTML = '';
        container.appendChild(table);
    }

    async function loadRevenuePage() {
        try {
            const data = await App.request('/admin/revenue/breakdown');
            const total = (data.cash || 0) + (data.upi || 0); // Total Revenue = Cash + UPI

            if (document.getElementById('rev-total'))
                document.getElementById('rev-total').textContent = App.formatCurrency(total);

            document.getElementById('rev-cash').textContent = App.formatCurrency(data.cash || 0);
            document.getElementById('rev-upi').textContent = App.formatCurrency(data.upi || 0);
            document.getElementById('rev-pending').textContent = App.formatCurrency(data.pending || 0);

            const ctx = document.getElementById('revenuePieChart').getContext('2d');
            if (window.revenuePieChartInstance) window.revenuePieChartInstance.destroy();

            window.revenuePieChartInstance = new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: ['Cash', 'UPI', 'Pending'],
                    datasets: [{
                        data: [data.cash || 0, data.upi || 0, data.pending || 0],
                        backgroundColor: ['#2ed573', '#54a0ff', '#ff6b6b']
                    }]
                }
            });
        } catch (e) { console.error(e); }
    }

    async function filterRevenueChart() {
        const month = document.getElementById('revenue-month-filter').value;
        let start = document.getElementById('revenue-start-date').value;
        let end = document.getElementById('revenue-end-date').value;

        if (month) {
            const [y, m] = month.split('-');
            const firstDay = new Date(y, m - 1, 1);
            const lastDay = new Date(y, m, 0);
            start = firstDay.toISOString().split('T')[0];
            end = lastDay.toISOString().split('T')[0];
            // Update date inputs to reflect month selection
            document.getElementById('revenue-start-date').value = start;
            document.getElementById('revenue-end-date').value = end;
        }

        try {
            const data = await App.request(`/admin/revenue/daily?startDate=${start}&endDate=${end}`);
            renderRevenueChart(data);
        } catch (e) { console.error(e); }
    }

    function renderRevenueChart(data) {
        const ctx = document.getElementById('revenueChart').getContext('2d');
        if (revenueChartInstance) revenueChartInstance.destroy();

        const labels = data.map(d => d.date);
        const values = data.map(d => d.total);

        revenueChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Revenue (₹)',
                    data: values,
                    backgroundColor: '#ff6b6b',
                    borderRadius: 5
                }]
            },
            options: { responsive: true, scales: { y: { beginAtZero: true } } }
        });
    }

    function renderStatusChart(data) {
        const ctx = document.getElementById('statusChart').getContext('2d');
        if (statusChartInstance) statusChartInstance.destroy();

        const labels = data.map(d => d.status);
        const values = data.map(d => d.count);
        const colors = ['#f1c40f', '#2ecc71', '#3498db', '#9b59b6', '#e74c3c'];

        statusChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors
                }]
            },
            options: { responsive: true }
        });
    }

    async function loadBusinessProfile() {
        try {
            const data = await App.request('/admin/business-profile');
            if (data) {
                const f = document.getElementById('business-profile-form');
                if (data.name) f.name.value = data.name;
                if (data.address) f.address.value = data.address;
                if (data.contact_number) f.contact_number.value = data.contact_number;
                if (data.delivery_charge) f.delivery_charge.value = data.delivery_charge;
                if (data.handling_charge) f.handling_charge.value = data.handling_charge;
                if (data.cart_value) f.cart_value.value = data.cart_value;
                if (data.open_time) f.open_time.value = data.open_time;
                if (data.close_time) f.close_time.value = data.close_time;
                if (data.break_start) f.break_start.value = data.break_start;
                if (data.break_end) f.break_end.value = data.break_end;
                if (data.weekly_holiday) f.weekly_holiday.value = data.weekly_holiday;

                const imgPreview = document.getElementById('preview-shop-image');
                if (data.shop_image_url) {
                    imgPreview.innerHTML = `<img src="${data.shop_image_url}" style="width:100px; height:100px; object-fit:cover; border-radius:8px">`;
                }

                const docPreview = document.getElementById('preview-licence-doc');
                if (data.licence_doc_url) {
                    docPreview.innerHTML = `<a href="${data.licence_doc_url}" target="_blank" class="btn btn-sm btn-secondary">View Licence</a>`;
                }
            }
        } catch (err) {
            console.error(err);
        }
    }

    async function viewOrder(id) {
        try {
            const data = await App.request(`/orders/${id}?_t=${Date.now()}`);
            document.getElementById('order-detail-id').textContent = data.order.id;

            // Build items table with header
            const itemsList = document.getElementById('order-detail-items');
            itemsList.innerHTML = `
                <table style="width:100%; border-collapse:collapse; margin-bottom:15px;">
                    <thead>
                        <tr style="background:#f5f5f5; border-bottom:2px solid #ddd;">
                            <th style="padding:8px; text-align:left;">Item Name</th>
                            <th style="padding:8px; text-align:center;">Item Count</th>
                            <th style="padding:8px; text-align:center;">Unit</th>
                            <th style="padding:8px; text-align:right;">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.items.map(i => `
                            <tr style="border-bottom:1px solid #eee;">
                                <td style="padding:8px;">${i.product_name}</td>
                                <td style="padding:8px; text-align:center;">${i.quantity}</td>
                                <td style="padding:8px; text-align:center;">${i.unit || 'per Unit'}</td>
                                <td style="padding:8px; text-align:right;">${App.formatCurrency(i.total_price)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;

            // Payment Summary
            const grandTotal = data.order.total_amount;
            const amountPaid = data.payment.amount_paid || 0;
            const remaining = grandTotal - amountPaid;

            document.getElementById('payment-grand-total').textContent = App.formatCurrency(grandTotal);
            document.getElementById('payment-amount-paid').textContent = App.formatCurrency(amountPaid);
            document.getElementById('payment-remaining').textContent = App.formatCurrency(remaining);
            document.getElementById('payment-remaining').style.color = remaining > 0 ? '#e74c3c' : '#27ae60';

            // Payment form population - default to Pending/Cash when no payment exists
            const pForm = document.getElementById('payment-form');
            pForm.dataset.orderId = id;
            pForm.status.value = data.payment.status || 'Pending';
            pForm.method.value = data.payment.method || 'Cash';

            // Populate existing values or clear fields
            if (data.payment.method === 'UPI') {
                document.getElementById('upi-transaction-id').value = data.payment.transaction_id || '';
                document.getElementById('upi-app-name').value = data.payment.app_name || '';
                document.getElementById('upi-amount').value = data.payment.amount_paid || '';
                document.getElementById('cash-amount').value = '';
            } else {
                document.getElementById('cash-amount').value = data.payment.amount_paid || '';
                document.getElementById('upi-transaction-id').value = '';
                document.getElementById('upi-app-name').value = '';
                document.getElementById('upi-amount').value = '';
            }

            // Trigger field visibility
            togglePaymentFields();

            const btn = document.getElementById('btn-print-invoice');
            if (btn) btn.dataset.orderId = id;

            App.showTab('admin-order-detail', 'admin-tab');
        } catch (err) {
            console.error(err);
        }
    }

    function togglePaymentFields() {
        const method = document.getElementById('payment-method-select').value;
        const cashFields = document.getElementById('cash-fields');
        const upiFields = document.getElementById('upi-fields');

        if (method === 'Cash') {
            cashFields.style.display = 'block';
            upiFields.style.display = 'none';
            // Clear UPI fields
            document.getElementById('upi-transaction-id').value = '';
            document.getElementById('upi-app-name').value = '';
            document.getElementById('upi-amount').value = '';
        } else {
            cashFields.style.display = 'none';
            upiFields.style.display = 'block';
            // Clear cash fields
            document.getElementById('cash-amount').value = '';
        }
    }

    async function submitPayment(e) {
        e.preventDefault();
        const form = e.target;
        const id = form.dataset.orderId;
        const method = form.method.value;

        let amount_paid = 0;
        let transaction_id = '';
        let app_name = '';

        if (method === 'Cash') {
            amount_paid = parseFloat(document.getElementById('cash-amount').value) || 0;
        } else { // UPI
            transaction_id = document.getElementById('upi-transaction-id').value;
            app_name = document.getElementById('upi-app-name').value;
            amount_paid = parseFloat(document.getElementById('upi-amount').value) || 0;

            if (!transaction_id || !app_name) {
                App.showToast('Transaction ID and App Name are mandatory for UPI', 'error', 'left');
                return;
            }
        }

        if (amount_paid < 0) {
            App.showToast('Invalid amount', 'error');
            return;
        }

        let status = 'Pending';
        const totalText = document.getElementById('payment-grand-total').textContent.replace(/[^0-9.]/g, '');
        const totalAmount = parseFloat(totalText) || 0;

        if (amount_paid >= totalAmount) {
            status = 'Paid';
        } else if (amount_paid > 0) {
            status = 'Partial';
        } else {
            status = 'Pending';
        }

        const data = {
            status: status,
            amount: amount_paid,
            amount_paid: amount_paid,
            method: method,
            transaction_id: transaction_id,
            app_name: app_name
        };

        try {
            await App.request(`/orders/${id}/payment`, 'POST', data);
            App.showToast('Payment updated successfully', 'info', 'left');
            await viewOrder(id);
            loadOrders();
        } catch (err) {
            console.error(err);
        }
    }

    function printInvoice(orderId) {
        if (!orderId) return console.error('No order ID for invoice');
        window.open(`/invoice.html?id=${orderId}`, '_blank');
    }

    async function editProduct(id) {
        try {
            const products = await App.request('/products');
            const p = products.find(x => x.id == id);
            if (!p) return;

            const form = document.getElementById('add-product-form');
            form.name.value = p.name;
            form.price.value = p.price;
            form.unit.value = p.unit;
            form.quantity.value = p.quantity;
            form.image_url.value = p.image_url || '';
            form.food_type.value = p.food_type || '';
            form.status.value = p.status;
            form.description.value = p.description || '';

            form.dataset.mode = 'edit';
            form.dataset.id = id;
            form.querySelector('button[type="submit"]').textContent = 'Update Product';
            document.querySelector('#admin-products h4').textContent = 'Edit Product';

            form.scrollIntoView({ behavior: 'smooth' });
        } catch (e) {
            console.error(e);
        }
    }

    async function updateStatus(id, status) {
        try {
            await App.request(`/orders/${id}/status`, 'PUT', { status });
            App.showToast(`Order #${id} marked as ${status}`, 'info', 'left');
        } catch (err) {
            console.error(err);
        }
    }

    async function saveUser(e) {
        e.preventDefault();
        const form = e.target;
        const mobile = form.mobile_number.value;
        const data = Object.fromEntries(new FormData(form));

        try {
            const encodedMobile = encodeURIComponent(mobile);
            await App.request(`/admin/users/${encodedMobile}`, 'PUT', data);
            App.showToast('User updated successfully');
            document.getElementById('edit-user-modal').style.display = 'none';
            loadUsers();
        } catch (err) {
            console.error(err);
            App.showToast(err.message, 'error');
        }
    }

    async function loadUsers() {
        const list = document.getElementById('admin-user-list');
        list.innerHTML = 'Loading...';
        try {
            const users = await App.request('/admin/users');
            list.innerHTML = '';

            if (users.length === 0) {
                list.innerHTML = '<div style="text-align:center; padding:40px; color:#666;"><h3>User Data Not Found!</h3></div>';
                return;
            }

            const table = document.createElement('table');
            table.innerHTML = `
                <thead>
                    <tr>
                        <th>Sr. No.</th>
                        <th>Name</th>
                        <th>Mobile</th>
                        <th>Alt Mobile</th>
                        <th>Address</th>
                        <th>Orders</th>
                        <th>Total Bill</th>
                        <th>Total Paid</th>
                        <th>Remaining</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody></tbody>
            `;
            const tbody = table.querySelector('tbody');

            users.forEach((u, idx) => {
                const tr = document.createElement('tr');
                tr.style.cursor = 'pointer';
                tr.onclick = (e) => Admin.toggleUserOrders(u.mobile_number, tr);
                tr.innerHTML = `
                    <td>${idx + 1}</td>
                    <td>${u.name || '-'}</td>
                    <td>${u.mobile_number}</td>
                    <td>${u.alt_mobile_number || '-'}</td>
                    <td>${u.address || '-'}</td>
                    <td>${u.total_orders}</td>
                    <td>${App.formatCurrency(u.total_bill_amount)}</td>
                    <td>${App.formatCurrency(u.total_paid_amount)}</td>
                    <td style="color: ${u.total_remaining > 0 ? 'red' : 'green'}; font-weight:bold;">${App.formatCurrency(u.total_remaining)}</td>
                    <td onclick="event.stopPropagation()">
                        <button class="btn btn-sm btn-secondary" onclick="Admin.editUser('${u.mobile_number}', '${u.name}', '${u.alt_mobile_number}', '${u.address}')">Edit</button>
                        <button class="btn btn-sm btn-danger" onclick="Admin.deleteUser('${u.mobile_number}')">Delete</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
            list.appendChild(table);
        } catch (err) {
            list.innerHTML = 'Error loading users';
            console.error(err);
        }
    }

    async function toggleUserOrders(mobile, row) {
        const nextRow = row.nextElementSibling;

        // Single Expansion Rule: Close other open rows first
        const parent = row.parentNode;
        const existingExpanded = parent.querySelector('.user-order-history-row');
        if (existingExpanded && existingExpanded !== nextRow) {
            existingExpanded.remove();
        }

        if (nextRow && nextRow.classList.contains('user-order-history-row')) {
            nextRow.remove();
            return;
        }

        try {
            const orders = await App.request(`/admin/users/${mobile}/orders`);
            const tr = document.createElement('tr');
            tr.className = 'user-order-history-row';
            tr.style.backgroundColor = '#a7b0a9'; // Requested background color

            let content;
            if (orders.length === 0) {
                content = `<div style="text-align:center; padding:20px; color:#666;"><h4>Order History Data Not Found!</h4></div>`;
            } else {
                content = `
                    <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                        <h4>Order History (${orders.length})</h4>
                        <button class="btn btn-sm btn-secondary" onclick="this.closest('tr').remove()">Collapse</button>
                    </div>
                    <table style="width:100%; border-collapse:collapse; background:white;">
                        <thead>
                            <tr style="border-bottom:2px solid #ddd;">
                                <th>Order ID</th>
                                <th>Date</th>
                                <th>Status</th>
                                <th>Payment</th>
                                <th>Items</th>
                                <th>Bill</th>
                                <th>Paid</th>
                                <th>Remaining</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${orders.map(o => `
                                <tr style="border-bottom:1px solid #eee;">
                                    <td>#${o.id}</td>
                                    <td>${new Date(o.created_at).toLocaleDateString()}</td>
                                    <td>${o.status}</td>
                                    <td>${o.payment_status}</td>
                                    <td>${o.items.map(i => `${i.product_name} (${i.quantity})`).join(', ')}</td>
                                    <td>${App.formatCurrency(o.total_amount)}</td>
                                    <td>${App.formatCurrency(o.amount_paid)}</td>
                                    <td style="color:${(o.total_amount - o.amount_paid) > 0 ? 'red' : 'green'}">${App.formatCurrency(o.total_amount - o.amount_paid)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                 `;
            }

            tr.innerHTML = `<td colspan="10" style="background:#f9f9f9; padding:15px;">${content}</td>`;
            row.parentNode.insertBefore(tr, row.nextSibling);

        } catch (e) {
            console.error(e);
        }
    }

    async function loadProducts() {
        const list = document.getElementById('admin-product-list');
        list.innerHTML = 'Loading...';
        try {
            const products = await App.request('/products');
            list.innerHTML = '';

            if (products.length === 0) {
                list.innerHTML = '<div style="text-align:center; padding:40px; color:#666;"><h3>Product Data Not Found!</h3></div>';
                return;
            }

            const table = document.createElement('table');
            table.innerHTML = `
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Image</th>
                        <th>Name</th>
                        <th>Price</th>
                        <th>Food Type</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody></tbody>
            `;
            const tbody = table.querySelector('tbody');

            products.forEach((p, index) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${index + 1}</td>
                    <td><img src="${p.image_url || 'https://via.placeholder.com/50'}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 8px;"></td>
                    <td>${p.name}</td>
                    <td>${App.formatCurrency(p.price)} / ${p.unit}</td>
                    <td>${p.food_type || 'Not Set'}</td>
                    <td>${p.status}</td>
                    <td>
                        <button class="btn btn-secondary btn-sm" onclick="Admin.editProduct(${p.id})">Edit</button>
                        <button class="btn btn-danger btn-sm" onclick="Admin.deleteProduct(${p.id})">Delete</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
            list.appendChild(table);
        } catch (err) {
            list.innerHTML = 'Error loading products';
        }
    }

    async function deleteProduct(id) {
        // Use SweetAlert2 for confirmation
        const result = await Swal.fire({
            title: 'Delete Product?',
            text: "This will remove the product from the menu.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ff6b6b',
            cancelButtonColor: '#95a5a6',
            confirmButtonText: 'Yes, delete it!'
        });

        if (result.isConfirmed) {
            try {
                console.log('Deleting product:', id);
                await App.request(`/products/${id}`, 'DELETE');

                // Success Toast
                const Toast = Swal.mixin({
                    toast: true,
                    position: 'top-end',
                    showConfirmButton: false,
                    timer: 3000,
                    timerProgressBar: true
                });
                Toast.fire({
                    icon: 'success',
                    title: 'Product deleted successfully'
                });

                loadProducts();
            } catch (err) {
                console.error('Delete failed:', err);
                Swal.fire('Error', 'Failed to delete product: ' + err.message, 'error');
            }
        }
    }

    async function loadOrders() {
        const list = document.getElementById('admin-order-list');
        list.innerHTML = 'Loading...';
        try {
            const orders = await App.request('/admin/orders');
            list.innerHTML = '';

            if (orders.length === 0) {
                list.innerHTML = '<div style="text-align:center; padding:40px; color:#666;"><h3>Order Data Not Found!</h3></div>';
                return;
            }

            const table = document.createElement('table');
            table.innerHTML = `
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Customer</th>
                        <th>Order Date</th>
                        <th>Total</th>
                        <th>Paid Amount</th>
                        <th>Remaining Balance</th>
                        <th>Payment Status</th>
                        <th>Order Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody></tbody>
            `;
            const tbody = table.querySelector('tbody');

            orders.forEach(o => {
                const tr = document.createElement('tr');
                const amountPaid = o.amount_paid || 0;
                const remainingBalance = o.total_amount - amountPaid;
                const isPaid = amountPaid >= o.total_amount;
                const paymentStatusStyle = isPaid ? 'background: #d4edda; padding: 4px 8px; border-radius: 4px; font-weight: 600;' : '';
                const paymentStatusText = isPaid ? 'Paid' : (amountPaid > 0 ? `Partial` : 'Pending');

                // Format order date
                const orderDate = new Date(o.created_at);
                const dateStr = orderDate.toLocaleDateString('en-GB'); // DD/MM/YYYY

                tr.innerHTML = `
                    <td>#${o.id}</td>
                    <td>${o.user_name || 'N/A'} (${o.user_mobile})</td>
                    <td>${dateStr}</td>
                    <td>${App.formatCurrency(o.total_amount)}</td>
                    <td>${App.formatCurrency(amountPaid)}</td>
                    <td>${App.formatCurrency(remainingBalance)}</td>
                    <td><span style="${paymentStatusStyle}">${paymentStatusText}</span></td>
                    <td>
                        <select class="status-select" onchange="Admin.updateStatus(${o.id}, this.value)">
                            <option value="Pending" ${o.status === 'Pending' ? 'selected' : ''}>Pending</option>
                            <option value="Accepted" ${o.status === 'Accepted' ? 'selected' : ''}>Accepted</option>
                            <option value="Preparing" ${o.status === 'Preparing' ? 'selected' : ''}>Preparing</option>
                            <option value="Delivered" ${o.status === 'Delivered' ? 'selected' : ''}>Delivered</option>
                            <option value="Cancelled" ${o.status === 'Cancelled' ? 'selected' : ''}>Cancelled</option>
                        </select>
                    </td>
                    <td>
                        <button class="btn btn-sm" onclick="Admin.viewOrder(${o.id})">View/Pay</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
            list.appendChild(table);
        } catch (err) {
            list.innerHTML = 'Error loading orders';
        }
    }


    function viewOrderItems(items) {
        if (!items || items.length === 0) {
            Swal.fire('No Items', 'No items found for this order.', 'info');
            return;
        }
        const html = `
            <table style="width:100%; border-collapse:collapse;">
                <thead>
                    <tr style="background:#f5f5f5; border-bottom:2px solid #ddd;">
                        <th style="padding:8px; text-align:left;">Item Name</th>
                        <th style="padding:8px; text-align:center;">Item Count</th>
                        <th style="padding:8px; text-align:center;">Unit</th>
                        <th style="padding:8px; text-align:right;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(i => `
                        <tr style="border-bottom:1px solid #eee;">
                            <td style="padding:8px;">${i.product_name}</td>
                            <td style="padding:8px; text-align:center;">${i.quantity}</td>
                            <td style="padding:8px; text-align:center;">${i.unit || 'per Unit'}</td>
                            <td style="padding:8px; text-align:right;">${App.formatCurrency(i.unit_price * i.quantity)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        Swal.fire({
            title: 'Ordered Items',
            html: html,
            width: 600,
            confirmButtonColor: '#3498db'
        });
    }

    async function viewOrderItemsByIndex(index) {
        const order = currentTodayOrders[index];
        if (!order) return;

        try {
            // Fetch fresh order details with items
            const fullOrder = await App.request(`/orders/${order.id}`);
            if (fullOrder && fullOrder.items) {
                viewOrderItems(fullOrder.items);
            } else {
                Swal.fire('Error', 'Could not load items', 'error');
            }
        } catch (e) {
            console.error(e);
            Swal.fire('Error', 'Failed to fetch items', 'error');
        }
    }

    return {
        init,
        loadStats,
        loadProducts,
        deleteProduct,
        loadOrders,
        updateStatus,
        viewOrder,
        submitPayment,
        togglePaymentFields,
        printInvoice,
        loadBusinessProfile,
        loadUsers,
        editProduct,
        loadRevenuePage,
        filterRevenueChart,
        toggleUserOrders,
        viewOrderItems,
        viewOrderItemsByIndex,
        saveUser,
        editUser,
        deleteUser
    };

    function editUser(mobile, name, alt, addr) {
        const modal = document.getElementById('edit-user-modal');
        const form = document.getElementById('edit-user-form');

        form.mobile_number.value = mobile;
        form.display_mobile.value = mobile;
        form.name.value = (name !== 'null' && name !== 'undefined') ? name : '';
        form.alt_mobile.value = (alt !== 'null' && alt !== 'undefined') ? alt : '';
        form.address.value = (addr !== 'null' && addr !== 'undefined') ? addr : '';

        modal.style.display = 'flex';
    }

    async function deleteUser(mobile) {
        const result = await Swal.fire({
            title: 'Delete User & All Data?',
            text: "This will permanently delete the user AND all their order history and payment records. This action cannot be undone!",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Yes, delete everything!'
        });

        if (result.isConfirmed) {
            try {
                const encodedMobile = encodeURIComponent(mobile);
                await App.request(`/admin/users/${encodedMobile}`, 'DELETE');
                App.showToast('User deleted', 'info');
                loadUsers();
            } catch (err) {
                console.error(err);
                App.showToast('Failed to delete user', 'error');
            }
        }
    }
})();
