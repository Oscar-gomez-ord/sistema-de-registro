let state = {
  config: { scriptUrl: '', bizName: 'Mi Tienda', currency: 'MXN', minStock: 5 },
  currentUser: null,
  isFirstSetup: false,
  users: [],
  products: [],
  customers: [],
  sales: [],
  cart: [],
  editingProductId: null,
  editingCustomerId: null,
  scannerTarget: 'pos', 
  scannerStream: null,
  scannerInterval: null,
  currentCat: '',
  lastReceiptData: null,
};

// Constantes de LocalStorage
const CONFIG_KEY = 'ventaflow_config';
const PRODUCTS_KEY = 'ventaflow_products';
const CUSTOMERS_KEY = 'ventaflow_customers';
const SALES_KEY = 'ventaflow_sales';

// Formateador de moneda nativo
const formatMoney = (amount) => {
  return new Intl.NumberFormat('es-MX', { 
    style: 'currency', 
    currency: state.config.currency || 'MXN' 
  }).format(amount);
};


// INICIALIZACIÓN

window.addEventListener('load', () => {
  loadLocal();
  
  if (!state.config.scriptUrl) {
    showSetup();
  } else {
    showApp();
    syncAll();
  }

  // Listener para el input del escáner (lector físico)
  const barcodeInput = document.getElementById('barcode-input');
  if(barcodeInput) {
    barcodeInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { 
        addByBarcode(e.target.value.trim()); 
        e.target.value = ''; 
      }
    });
  }

  // Listener para el descuento
  const discountInput = document.getElementById('discount-input');
  if(discountInput) {
    discountInput.addEventListener('input', updateCartUI);
  }

  setDefaultDates();
});

function loadLocal() {
  const c = localStorage.getItem(CONFIG_KEY);
  if (c) state.config = { ...state.config, ...JSON.parse(c) };
  
  const p = localStorage.getItem(PRODUCTS_KEY);
  if (p) state.products = JSON.parse(p);
  
  const cu = localStorage.getItem(CUSTOMERS_KEY);
  if (cu) state.customers = JSON.parse(cu);
  
  const s = localStorage.getItem(SALES_KEY);
  if (s) state.sales = JSON.parse(s);
}

function saveLocal() {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config));
  localStorage.setItem(PRODUCTS_KEY, JSON.stringify(state.products));
  localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(state.customers));
  localStorage.setItem(SALES_KEY, JSON.stringify(state.sales));
}

function showSetup() {
  document.getElementById('setup-page').style.display = '';
  document.getElementById('main-app').style.display = 'none';
}

function showApp() {
  document.getElementById('setup-page').style.display = 'none';
  // Si no hay usuario logueado, muestra el Lock Screen
  if (!state.currentUser) {
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('lock-screen').style.display = 'flex';
  } else {
    document.getElementById('lock-screen').style.display = 'none';
    document.getElementById('main-app').style.display = '';
    switchPage('pos');
  }
}

// SETUP Y ONBOARDING
function showSetupStep(n) {
  [1, 2, 3].forEach(i => {
    document.getElementById(`setup-step-${i}`).style.display = i === n ? '' : 'none';
    document.getElementById(`step-tab-${i}`).classList.toggle('active', i === n);
  });
}

function copyScript() {
  const code = document.getElementById('apps-script-code').textContent;
  navigator.clipboard.writeText(code).then(() => toast('Código copiado al portapapeles', 'success'));
}

async function testConnection() {
  const url = document.getElementById('script-url-input').value.trim();
  if (!url) { toast('Ingresa la URL del script', 'error'); return; }
  
  document.getElementById('test-spinner').style.display = '';
  document.getElementById('test-btn').disabled = true;
  const result = document.getElementById('test-result');
  
  try {
    const res = await fetch(url + '?action=read&tab=Productos');
    const data = await res.json();
    if (data.ok) {
      result.innerHTML = '<span style="color:var(--green)">✓ Conexión exitosa. Base de datos lista.</span>';
    } else {
      result.innerHTML = '<span style="color:var(--red)">✗ Error: ' + (data.error || 'Respuesta inválida') + '</span>';
    }
  } catch(e) {
    result.innerHTML = '<span style="color:var(--red)">✗ No se pudo conectar. Verifica la URL y permisos.</span>';
  }
  
  document.getElementById('test-spinner').style.display = 'none';
  document.getElementById('test-btn').disabled = false;
}

async function saveConfig() {
  const url = document.getElementById('script-url-input').value.trim();
  const biz = document.getElementById('biz-name-input').value.trim() || 'Mi Tienda';
  if (!url) { toast('Ingresa la URL del script', 'error'); return; }
  
  const btn = document.getElementById('save-config-btn');
  btn.disabled = true; btn.textContent = 'Conectando...';

  state.config.scriptUrl = url;
  state.config.bizName = biz;
  saveLocal();
  
  await syncAll(); // Esperamos a que baje la BD

  btn.disabled = false; btn.textContent = '✓ Guardar y comenzar';
  document.getElementById('setup-page').style.display = 'none';

  // Si la BD de usuarios está vacía, forzamos crear el admin
  if (state.users.length === 0) {
    state.isFirstSetup = true;
    openUserModal(null, true);
  } else {
    showApp();
  }
}

// API Y SINCRONIZACIÓN (GOOGLE SHEETS)
async function apiCall(params) {
  const { scriptUrl } = state.config;
  if (!scriptUrl) return null;
  
  try {
    const res = await fetch(scriptUrl, {
      method: 'POST',
      body: JSON.stringify(params),
      headers: { 'Content-Type': 'text/plain' }
    });
    return await res.json();
  } catch (e) {
    setSyncStatus(false);
    return null;
  }
}

async function syncAll() {
  setSyncStatus(null, 'Sincronizando...');
  
  const [prodData, custData, salesData] = await Promise.all([
    apiCall({ action: 'read', tab: 'Productos' }),
    apiCall({ action: 'read', tab: 'Clientes' }),
    apiCall({ action: 'read', tab: 'Usuarios' }),
    apiCall({ action: 'read', tab: 'Ventas' }),
  ]);

  if (prodData?.ok) {
    state.products = prodData.rows.filter(r => r.id);
    renderInventory();
    renderPOSProducts();
  }
  if (usersData?.ok) {
    state.users = usersData.rows.filter(r => r.id);
  }
  if (custData?.ok) {
    state.customers = custData.rows.filter(r => r.id);
    renderCRM();
    populateCustomerSelect();
  }
  if (salesData?.ok) {
    state.sales = salesData.rows.filter(r => r.id);
    renderHistory();
    if(document.getElementById('page-reports').style.display !== 'none') renderReports();
  }
  
  saveLocal();
  setSyncStatus(true, 'Sincronizado');
}

function setSyncStatus(ok, text) {
  const dot = document.getElementById('sync-dot');
  const txt = document.getElementById('sync-text');
  if (!dot || !txt) return;
  
  if (ok === null) { 
    dot.style.background = 'var(--accent)'; 
    txt.textContent = text || 'Sincronizando...'; 
  } else if (ok) { 
    dot.style.background = 'var(--green)'; 
    txt.textContent = text || 'Conectado'; 
  } else { 
    dot.style.background = 'var(--red)'; 
    txt.textContent = text || 'Sin conexión'; 
  }
}

// NAVEGACIÓN
const PAGE_TITLES = {
  pos: 'Punto de Venta',
  inventory: 'Inventario',
  crm: 'Clientes CRM',
  reports: 'Reportes',
  'sales-hist': 'Historial de Ventas',
  users: 'Gestión de Personal',
};

function switchPage(page) {
  Object.keys(PAGE_TITLES).forEach(p => {
    const el = document.getElementById(`page-${p}`);
    if (el) el.style.display = p === page ? '' : 'none';
    const nav = document.getElementById(`nav-${p}`);
    if (nav) nav.classList.toggle('active', p === page);
  });
  
  document.getElementById('page-title').textContent = PAGE_TITLES[page] || page;
  
  if (page === 'reports') renderReports();
  if (page === 'sales-hist') renderHistory();
}

// PUNTO DE VENTA (POS) - PRODUCTOS
function renderPOSProducts() {
  const cats = [...new Set(state.products.map(p => p.category).filter(Boolean))];
  const catsDiv = document.getElementById('pos-cats');
  
  if(catsDiv) {
    catsDiv.innerHTML = '<div class="chip active" onclick="filterCat(\'\')" data-cat="">Todos</div>';
    cats.forEach(c => catsDiv.innerHTML += `<div class="chip" onclick="filterCat('${c}')" data-cat="${c}">${c}</div>`);
  }
  filterCat(state.currentCat);
}

function filterCat(cat) {
  state.currentCat = cat;
  document.querySelectorAll('#pos-cats .chip').forEach(c => c.classList.toggle('active', c.dataset.cat === cat));
  
  const grid = document.getElementById('pos-products');
  if(!grid) return;

  const prods = cat ? state.products.filter(p => p.category === cat) : state.products;
  
  if (!prods.length) {
    grid.innerHTML = '<div style="grid-column:1/-1"><div class="empty-state"><p>No hay productos en esta categoría.</p></div></div>';
    return;
  }
  
  grid.innerHTML = prods.map(p => {
    const stockLow = parseInt(p.stock) <= parseInt(state.config.minStock);
    return `
      <div class="product-tile" onclick="addToCart('${p.id}')">
        <div class="p-cat">${p.category || 'Sin categoría'}</div>
        <div class="p-name">${p.name}</div>
        <div class="p-price">${formatMoney(p.price)}</div>
        <div class="p-stock ${stockLow ? 'badge-red' : ''}" style="font-size:11px;color:${stockLow ? 'var(--red)' : 'var(--text-muted)'}">
          Stock: ${p.stock||0} ${p.unit||''}
        </div>
      </div>
    `;
  }).join('');
}

function addByBarcode(code) {
  if (!code) return;
  const prod = state.products.find(p => String(p.barcode) === code);
  if (prod) { 
    addToCart(prod.id); 
  } else { 
    toast(`Código ${code} no encontrado`, 'error'); 
  }
}

// CARRITO DE COMPRAS
function addToCart(productId) {
  const prod = state.products.find(p => String(p.id) === String(productId));
  if (!prod) return;
  
  const existing = state.cart.find(i => i.productId === productId);
  if (existing) {
    if (parseInt(existing.qty) >= parseInt(prod.stock)) {
      toast(`Stock insuficiente (${prod.stock} disponibles)`, 'error'); return;
    }
    existing.qty++;
  } else {
    state.cart.push({ 
      productId, 
      name: prod.name, 
      price: parseFloat(prod.price), 
      qty: 1 
    });
  }
  updateCartUI();
}

function updateQty(productId, delta) {
  const item = state.cart.find(i => i.productId === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) state.cart = state.cart.filter(i => i.productId !== productId);
  updateCartUI();
}

function clearCart() {
  state.cart = [];
  const discountInput = document.getElementById('discount-input');
  if(discountInput) discountInput.value = 0;
  updateCartUI();
}

function updateCartUI() {
  const items = document.getElementById('cart-items');
  if(!items) return;

  if (!state.cart.length) {
    items.innerHTML = `<div class="cart-empty"><p>El carrito está vacío.<br>Escanea o toca un producto.</p></div>`;
    document.getElementById('cart-subtotal').textContent = formatMoney(0);
    document.getElementById('cart-total').textContent = formatMoney(0);
    return;
  }
  
  items.innerHTML = state.cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-price">${formatMoney(item.price)} × ${item.qty}</div>
      </div>
      <div class="qty-control">
        <button class="qty-btn" onclick="updateQty('${item.productId}',-1)">−</button>
        <span class="qty-num">${item.qty}</span>
        <button class="qty-btn" onclick="updateQty('${item.productId}',1)">+</button>
      </div>
      <div class="cart-item-total">${formatMoney(item.price * item.qty)}</div>
    </div>
  `).join('');

  const subtotal = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
  const disc = parseFloat(document.getElementById('discount-input').value) || 0;
  const total = subtotal * (1 - disc/100);
  
  document.getElementById('cart-subtotal').textContent = formatMoney(subtotal);
  document.getElementById('cart-total').textContent = formatMoney(total);
}

// CHECKOUT Y PAGOS
function handleCashCheckout() {
  if (!state.cart.length) { toast('El carrito está vacío', 'error'); return; }
  
  const subtotal = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
  const disc = parseFloat(document.getElementById('discount-input').value) || 0;
  const total = subtotal * (1 - disc/100);
  
  document.getElementById('cash-total-display').textContent = formatMoney(total);
  document.getElementById('cash-received').value = '';
  document.getElementById('cash-change-display').textContent = formatMoney(0);
  document.getElementById('btn-confirm-cash').disabled = true;
  document.getElementById('cash-modal').style.display = '';
  
  setTimeout(() => document.getElementById('cash-received').focus(), 100);
}

function calculateChange() {
  const subtotal = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
  const disc = parseFloat(document.getElementById('discount-input').value) || 0;
  const total = subtotal * (1 - disc/100);
  const received = parseFloat(document.getElementById('cash-received').value) || 0;
  
  const change = received - total;
  const btn = document.getElementById('btn-confirm-cash');
  const display = document.getElementById('cash-change-display');
  
  if (received >= total) {
    display.textContent = formatMoney(change);
    display.style.color = 'var(--green)';
    btn.disabled = false;
  } else {
    display.textContent = "Monto insuficiente";
    display.style.color = 'var(--red)';
    btn.disabled = true;
  }
}

function confirmCashCheckout() {
  const received = parseFloat(document.getElementById('cash-received').value) || 0;
  closeModal('cash-modal');
  checkout('Efectivo', received);
}

async function checkout(method, amountReceived = 0) {
  if (!state.cart.length) { toast('El carrito está vacío', 'error'); return; }
  
  const subtotal = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
  const disc = parseFloat(document.getElementById('discount-input').value) || 0;
  const total = subtotal * (1 - disc/100);
  const custId = document.getElementById('cart-customer').value;
  const custName = custId ? (state.customers.find(c => c.id === custId)?.name || '') : 'General';

  const saleId = 'S' + Date.now();
  const date = new Date().toISOString();

  const sale = {
    id: saleId,
    date,
    total: total.toFixed(2),
    subtotal: subtotal.toFixed(2),
    discount: disc,
    paymentMethod: method,
    amountReceived: method === 'Efectivo' ? amountReceived : total,
    change: method === 'Efectivo' ? (amountReceived - total).toFixed(2) : 0,
    customerId: custId || '',
    customerName: custName,
    sellerName: state.currentUser.name, // <--- AÑADIR ESTO
    items: state.cart.length,
  };

  // Descontar inventario localmente
  state.cart.forEach(item => {
    const prod = state.products.find(p => p.id === item.productId);
    if (prod) prod.stock = Math.max(0, parseInt(prod.stock) - item.qty);
  });

  state.sales.unshift(sale);
  saveLocal();
  
  showReceipt(sale, state.cart.slice());
  
  // Guardamos un clon del carrito para la API antes de vaciarlo localmente
  const cartClone = state.cart.slice();
  clearCart();
  renderPOSProducts();
  renderInventory();

  // Sincronizar en la nube (No bloqueamos la UI esperando la red)
  setSyncStatus(null, 'Guardando...');
  
  apiCall({ action: 'write', tab: 'Ventas', rows: [sale] }).then(async () => {
    // Actualizar stock en la nube
    for (const item of cartClone) {
      const prod = state.products.find(p => p.id === item.productId);
      if (prod) {
        await apiCall({ 
          action: 'updateRow', tab: 'Productos', 
          idField: 'id', idValue: prod.id, 
          updates: { stock: prod.stock } 
        });
      }
    }

    // Actualizar totales del cliente en la nube
    if (custId) {
      const cust = state.customers.find(c => c.id === custId);
      if (cust) {
        cust.totalPurchases = (parseInt(cust.totalPurchases)||0) + 1;
        cust.totalAmount = ((parseFloat(cust.totalAmount)||0) + total).toFixed(2);
        await apiCall({ 
          action: 'updateRow', tab: 'Clientes', 
          idField: 'id', idValue: custId, 
          updates: { totalPurchases: cust.totalPurchases, totalAmount: cust.totalAmount } 
        });
      }
    }
    setSyncStatus(true, 'Guardado');
  }).catch(() => setSyncStatus(false, 'Error al guardar'));

  toast('Venta registrada exitosamente', 'success');
}

// TICKETS E IMPRESIÓN
function showReceipt(sale, cartItems) {
  const body = document.getElementById('receipt-body');
  body.innerHTML = `
    <div style="text-align:center;margin-bottom:16px">
      <div style="font-size:48px">✓</div>
      <div style="font-size:24px;font-weight:800">${formatMoney(sale.total)}</div>
      <div style="color:var(--text-muted);font-size:13px">${sale.paymentMethod} · ${sale.customerName}</div>
      ${sale.paymentMethod === 'Efectivo' ? `<div style="font-size:12px; margin-top:5px; color:var(--green)">Cambio: ${formatMoney(sale.change)}</div>` : ''}
    </div>
  `;
  state.lastReceiptData = { sale, cartItems };
  document.getElementById('receipt-modal').style.display = '';
}

function printReceipt() {
  if (!state.lastReceiptData) return;
  const { sale, cartItems } = state.lastReceiptData;
  const w = window.open('', '_blank', 'width=350,height=600');
  
  w.document.write(`
    <!DOCTYPE html>
    <html><head><title>Ticket de Compra</title>
    <style>
      @page { margin: 0; }
      body { font-family: 'Courier New', Courier, monospace; font-size: 12px; color: #000; width: 300px; margin: 0 auto; padding: 10px; }
      h1 { text-align: center; font-size: 18px; margin: 0 0 10px 0; text-transform: uppercase; }
      .text-center { text-align: center; }
      .line { border-top: 1px dashed #000; margin: 5px 0; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 3px 0; vertical-align: top; }
      .right { text-align: right; }
      .bold { font-weight: bold; }
      .totals { margin-top: 10px; }
      .totals-row { display: flex; justify-content: space-between; padding: 2px 0; }
      .total-final { font-size: 16px; font-weight: bold; margin-top: 5px; border-top: 1px dashed #000; padding-top: 5px; }
    </style>
    </head><body onload="window.print(); window.close();">
      <h1>${state.config.bizName}</h1>
      <div class="text-center">Ticket: ${sale.id}</div>
      <div class="text-center">Fecha: ${new Date(sale.date).toLocaleString('es')}</div>
      <div class="text-center">Cliente: ${sale.customerName}</div>
      <div class="line"></div>
      
      <table>
        <thead><tr><th>Cant</th><th>Descripción</th><th class="right">Importe</th></tr></thead>
        <tbody>
          ${cartItems.map(i => `
            <tr>
              <td>${i.qty}</td>
              <td>${i.name}<br><small>${formatMoney(i.price)}</small></td>
              <td class="right">${formatMoney(i.price * i.qty)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      
      <div class="line"></div>
      <div class="totals">
        <div class="totals-row"><span>Subtotal:</span><span>${formatMoney(sale.subtotal)}</span></div>
        ${sale.discount > 0 ? `<div class="totals-row"><span>Descuento (${sale.discount}%):</span><span>-${formatMoney(sale.subtotal - sale.total)}</span></div>` : ''}
        <div class="totals-row total-final"><span>TOTAL:</span><span>${formatMoney(sale.total)}</span></div>
      </div>
      
      <div class="line"></div>
      <div class="totals-row"><span>Pago con (${sale.paymentMethod}):</span><span>${sale.amountReceived ? formatMoney(sale.amountReceived) : formatMoney(sale.total)}</span></div>
      ${sale.paymentMethod === 'Efectivo' ? `<div class="totals-row"><span>Cambio:</span><span>${formatMoney(sale.change)}</span></div>` : ''}
      
      <div class="line"></div>
      <div class="text-center" style="margin-top: 15px;">¡Gracias por su compra!</div>
      <div class="text-center" style="font-size:10px; margin-top:5px;">Generado por VentaFlow</div>
    </body></html>
  `);
  w.document.close();
}

// INVENTARIO
function renderInventory() {
  const q = (document.getElementById('inv-search')?.value||'').toLowerCase();
  const cat = document.getElementById('inv-cat-filter')?.value||'';

  const catFilter = document.getElementById('inv-cat-filter');
  if (catFilter) {
    const cats = [...new Set(state.products.map(p => p.category).filter(Boolean))];
    catFilter.innerHTML = '<option value="">Todas las categorías</option>';
    cats.forEach(c => catFilter.innerHTML += `<option value="${c}" ${cat===c?'selected':''}>${c}</option>`);
  }

  const dl = document.getElementById('cat-list');
  if (dl) {
    const cats = [...new Set(state.products.map(p => p.category).filter(Boolean))];
    dl.innerHTML = cats.map(c => `<option value="${c}">`).join('');
  }

  let prods = state.products;
  if (q) prods = prods.filter(p => p.name?.toLowerCase().includes(q) || p.barcode?.includes(q) || p.category?.toLowerCase().includes(q));
  if (cat) prods = prods.filter(p => p.category === cat);

  const tbody = document.getElementById('inv-tbody');
  if (!tbody) return;
  
  if (!prods.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><p>No hay productos. Agrega tu primer producto.</p></div></td></tr>`;
    return;
  }
  
  tbody.innerHTML = prods.map(p => {
    const margin = p.cost > 0 ? (((parseFloat(p.price)-parseFloat(p.cost))/parseFloat(p.cost))*100).toFixed(0) : '—';
    const stockLow = parseInt(p.stock) <= parseInt(state.config.minStock);
    return `<tr>
      <td><span class="mono" style="font-size:12px;color:var(--text-muted)">${p.barcode||'—'}</span></td>
      <td style="font-weight:600">${p.name}</td>
      <td><span class="badge badge-blue">${p.category||'—'}</span></td>
      <td class="mono">${formatMoney(p.price)}</td>
      <td class="mono" style="color:var(--text-muted)">${p.cost ? formatMoney(p.cost) : '—'}</td>
      <td><span class="badge ${stockLow?'badge-red':'badge-green'}">${p.stock||0} ${p.unit||''}</span></td>
      <td style="color:var(--green)">${margin !== '—' ? margin+'%' : '—'}</td>
      <td style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" onclick="openProductModal('${p.id}')">✏️</button>
        <button class="btn btn-ghost btn-sm" onclick="adjustStock('${p.id}')">📦</button>
        <button class="btn btn-danger btn-sm" onclick="deleteProduct('${p.id}')">🗑</button>
      </td>
    </tr>`;
  }).join('');
}

function openProductModal(id) {
  state.editingProductId = id || null;
  const title = document.getElementById('prod-modal-title');
  if (id) {
    const p = state.products.find(p => p.id === id);
    if (!p) return;
    title.textContent = 'Editar Producto';
    document.getElementById('prod-name').value = p.name || '';
    document.getElementById('prod-barcode').value = p.barcode || '';
    document.getElementById('prod-category').value = p.category || '';
    document.getElementById('prod-price').value = p.price || '';
    document.getElementById('prod-cost').value = p.cost || '';
    document.getElementById('prod-stock').value = p.stock || '';
    document.getElementById('prod-unit').value = p.unit || 'pza';
  } else {
    title.textContent = 'Nuevo Producto';
    ['prod-name','prod-barcode','prod-category','prod-price','prod-cost','prod-stock'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('prod-unit').value = 'pza';
  }
  document.getElementById('product-modal').style.display = '';
}

async function saveProduct() {
  const name = document.getElementById('prod-name').value.trim();
  if (!name) { toast('El nombre es requerido', 'error'); return; }
  
  const prod = {
    id: state.editingProductId || ('P' + Date.now()),
    barcode: document.getElementById('prod-barcode').value.trim(),
    name,
    category: document.getElementById('prod-category').value.trim(),
    price: parseFloat(document.getElementById('prod-price').value) || 0,
    cost: parseFloat(document.getElementById('prod-cost').value) || 0,
    stock: parseInt(document.getElementById('prod-stock').value) || 0,
    unit: document.getElementById('prod-unit').value,
  };

  const btn = document.getElementById('save-prod-btn');
  btn.disabled = true; btn.textContent = 'Guardando...';

  if (state.editingProductId) {
    const idx = state.products.findIndex(p => p.id === state.editingProductId);
    if (idx >= 0) state.products[idx] = prod;
    await apiCall({ action: 'updateRow', tab: 'Productos', idField: 'id', idValue: prod.id, updates: prod });
    toast('Producto actualizado', 'success');
  } else {
    state.products.unshift(prod);
    await apiCall({ action: 'write', tab: 'Productos', rows: [prod] });
    toast('Producto agregado', 'success');
  }

  saveLocal();
  closeModal('product-modal');
  renderInventory();
  renderPOSProducts();
  btn.disabled = false; btn.textContent = 'Guardar Producto';
}

async function deleteProduct(id) {
  if (!confirm('¿Eliminar este producto?')) return;
  state.products = state.products.filter(p => p.id !== id);
  saveLocal();
  renderInventory();
  renderPOSProducts();
  
  await apiCall({ action: 'deleteRow', tab: 'Productos', idField: 'id', idValue: id });
  toast('Producto eliminado', 'success');
}

function adjustStock(id) {
  const prod = state.products.find(p => p.id === id);
  if (!prod) return;
  
  const qty = prompt(`Ajustar stock de "${prod.name}"\nStock actual: ${prod.stock}\nIngresa la cantidad a sumar (negativo para restar):`);
  if (qty === null) return;
  
  const delta = parseInt(qty);
  if (isNaN(delta)) { toast('Cantidad inválida', 'error'); return; }
  
  prod.stock = Math.max(0, parseInt(prod.stock) + delta);
  saveLocal();
  renderInventory();
  renderPOSProducts();
  
  apiCall({ action: 'updateRow', tab: 'Productos', idField: 'id', idValue: id, updates: { stock: prod.stock } });
  toast(`Stock ajustado: ${prod.stock} ${prod.unit}`, 'success');
}

// CRM (CLIENTES)
function renderCRM() {
  const q = (document.getElementById('crm-search')?.value||'').toLowerCase();
  let custs = state.customers;
  if (q) custs = custs.filter(c => c.name?.toLowerCase().includes(q) || c.phone?.includes(q) || c.email?.toLowerCase().includes(q));

  const grid = document.getElementById('crm-grid');
  if (!grid) return;
  
  if (!custs.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><p>No hay clientes registrados.</p></div>';
    return;
  }
  
  grid.innerHTML = custs.map(c => `
    <div class="customer-card">
      <div>
        <div class="customer-name">${c.name}</div>
        <div class="customer-meta">${c.phone ? '📞 '+c.phone : ''} ${c.email ? '✉️ '+c.email : ''}</div>
        ${c.notes ? `<div style="font-size:12px;color:var(--text-dim);margin-top:4px">${c.notes}</div>` : ''}
      </div>
      <div style="text-align:right">
        <div style="font-size:18px;font-weight:800;font-family:'JetBrains Mono',monospace">${formatMoney(c.totalAmount)}</div>
        <div style="font-size:12px;color:var(--text-muted)">${c.totalPurchases||0} compras</div>
        <div style="display:flex;gap:6px;margin-top:8px; justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" onclick="openCustomerModal('${c.id}')">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="deleteCustomer('${c.id}')">🗑</button>
        </div>
      </div>
    </div>
  `).join('');
}

function populateCustomerSelect() {
  const sel = document.getElementById('cart-customer');
  if (!sel) return;
  sel.innerHTML = '<option value="">Cliente general</option>';
  state.customers.forEach(c => sel.innerHTML += `<option value="${c.id}">${c.name}</option>`);
}

function openCustomerModal(id) {
  state.editingCustomerId = id || null;
  if (id) {
    const c = state.customers.find(c => c.id === id);
    if (!c) return;
    document.getElementById('cust-modal-title').textContent = 'Editar Cliente';
    document.getElementById('cust-name').value = c.name || '';
    document.getElementById('cust-phone').value = c.phone || '';
    document.getElementById('cust-email').value = c.email || '';
    document.getElementById('cust-notes').value = c.notes || '';
  } else {
    document.getElementById('cust-modal-title').textContent = 'Nuevo Cliente';
    ['cust-name','cust-phone','cust-email','cust-notes'].forEach(id => document.getElementById(id).value = '');
  }
  document.getElementById('customer-modal').style.display = '';
}

async function saveCustomer() {
  const name = document.getElementById('cust-name').value.trim();
  if (!name) { toast('El nombre es requerido', 'error'); return; }
  
  const cust = {
    id: state.editingCustomerId || ('C' + Date.now()),
    name,
    phone: document.getElementById('cust-phone').value.trim(),
    email: document.getElementById('cust-email').value.trim(),
    notes: document.getElementById('cust-notes').value.trim(),
    totalPurchases: 0,
    totalAmount: 0,
    createdAt: new Date().toISOString(),
  };

  if (state.editingCustomerId) {
    const orig = state.customers.find(c => c.id === state.editingCustomerId);
    cust.totalPurchases = orig?.totalPurchases || 0;
    cust.totalAmount = orig?.totalAmount || 0;
    
    const idx = state.customers.findIndex(c => c.id === state.editingCustomerId);
    state.customers[idx] = cust;
    await apiCall({ action: 'updateRow', tab: 'Clientes', idField: 'id', idValue: cust.id, updates: cust });
    toast('Cliente actualizado', 'success');
  } else {
    state.customers.unshift(cust);
    await apiCall({ action: 'write', tab: 'Clientes', rows: [cust] });
    toast('Cliente agregado', 'success');
  }

  saveLocal();
  closeModal('customer-modal');
  renderCRM();
  populateCustomerSelect();
}

async function deleteCustomer(id) {
  if (!confirm('¿Eliminar este cliente?')) return;
  state.customers = state.customers.filter(c => c.id !== id);
  saveLocal();
  renderCRM();
  populateCustomerSelect();
  await apiCall({ action: 'deleteRow', tab: 'Clientes', idField: 'id', idValue: id });
  toast('Cliente eliminado', 'success');
}

// REPORTES Y ANÁLISIS
function renderReports() {
  const todayDate = new Date().toISOString().split('T')[0];
  const thisMonth = todayDate.substring(0,7);
  
  const totalToday = state.sales.filter(s => s.date?.startsWith(todayDate)).reduce((sum, s) => sum + parseFloat(s.total), 0);
  const totalMonth = state.sales.filter(s => s.date?.startsWith(thisMonth)).reduce((sum, s) => sum + parseFloat(s.total), 0);
  const totalSales = state.sales.length;
  const avgTicket = totalSales > 0 ? (state.sales.reduce((s,v)=>s+parseFloat(v.total),0)/totalSales) : 0;

  const statsGrid = document.getElementById('report-stats');
  if (statsGrid) {
    statsGrid.innerHTML = `
      <div class="stat-card amber">
        <div class="stat-value">${formatMoney(totalToday)}</div>
        <div class="stat-label">Ventas de hoy</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-value">${formatMoney(totalMonth)}</div>
        <div class="stat-label">Ventas del mes</div>
      </div>
      <div class="stat-card green">
        <div class="stat-value">${totalSales}</div>
        <div class="stat-label">Total transacciones</div>
      </div>
      <div class="stat-card amber">
        <div class="stat-value">${formatMoney(avgTicket)}</div>
        <div class="stat-label">Ticket promedio</div>
      </div>
    `;
  }

  // Gráfico de barras simple en HTML/CSS para los últimos 7 días
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const total = state.sales.filter(s => s.date?.startsWith(dateStr)).reduce((sum, s) => sum + parseFloat(s.total), 0);
    last7.push({ date: d.toLocaleDateString('es', { weekday: 'short', day: 'numeric' }), total });
  }
  
  const maxVal = Math.max(...last7.map(d => d.total), 1);
  const chartEl = document.getElementById('sales-chart');
  
  if (chartEl) {
    const wrap = chartEl.parentElement;
    let chartDiv = wrap.querySelector('.bar-chart');
    if (!chartDiv) {
      chartEl.style.display = 'none';
      chartDiv = document.createElement('div');
      chartDiv.className = 'bar-chart';
      chartDiv.style.cssText = 'display:flex;align-items:flex-end;gap:8px;height:180px;padding-top:20px';
      wrap.appendChild(chartDiv);
    }
    chartDiv.innerHTML = last7.map(d => `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
        <div style="font-size:10px;color:var(--text-muted);">${formatMoney(d.total)}</div>
        <div style="width:100%;background:var(--accent);border-radius:4px 4px 0 0;height:${Math.max(4,(d.total/maxVal)*140)}px;transition:height 0.3s;min-height:4px"></div>
        <div style="font-size:11px;color:var(--text-muted);white-space:nowrap">${d.date}</div>
      </div>
    `).join('');
  }

  // Métodos de Pago
  const topEl = document.getElementById('top-products');
  if (topEl) {
    const payMethods = {};
    state.sales.forEach(s => { payMethods[s.paymentMethod] = (payMethods[s.paymentMethod]||0) + parseFloat(s.total); });
    const sorted = Object.entries(payMethods).sort((a,b)=>b[1]-a[1]);
    const totalAll = sorted.reduce((s,[,v])=>s+v,0);
    
    topEl.innerHTML = sorted.length ? sorted.map(([method, amount]) => `
      <div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:14px;font-weight:600">${method}</span>
          <span style="font-family:'JetBrains Mono',monospace;font-size:14px">${formatMoney(amount)}</span>
        </div>
        <div style="background:var(--surface3);border-radius:4px;height:4px;overflow:hidden">
          <div style="background:var(--accent);width:${(amount/totalAll*100).toFixed(0)}%;height:100%;border-radius:4px"></div>
        </div>
      </div>
    `).join('') : '<div style="color:var(--text-muted);font-size:14px;padding:20px 0">No hay ventas registradas</div>';
  }
}

// HISTORIAL DE VENTAS
function setDefaultDates() {
  const today = new Date().toISOString().split('T')[0];
  const from = new Date(); 
  from.setDate(from.getDate()-30);
  
  const el1 = document.getElementById('hist-from');
  const el2 = document.getElementById('hist-to');
  if (el1) el1.value = from.toISOString().split('T')[0];
  if (el2) el2.value = today;
}

function filterHistory() { renderHistory(); }

function renderHistory() {
  const tbody = document.getElementById('hist-tbody');
  if (!tbody) return;
  
  const from = document.getElementById('hist-from')?.value;
  const to = document.getElementById('hist-to')?.value;
  
  let sales = [...state.sales].sort((a,b)=>new Date(b.date)-new Date(a.date));
  if (from) sales = sales.filter(s => s.date >= from);
  if (to) sales = sales.filter(s => s.date <= to + 'T23:59:59');
  
  if (!sales.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><p>No hay ventas en este período</p></div></td></tr>';
    return;
  }
  
  const methodColors = { 'Efectivo': 'badge-green', 'Tarjeta': 'badge-blue', 'Transferencia': 'badge-amber' };
  
  tbody.innerHTML = sales.map(s => `
    <tr>
      <td class="mono" style="font-size:12px;color:var(--text-muted)">${s.id}</td>
      <td>${new Date(s.date).toLocaleString('es', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}</td>
      <td>${s.customerName || 'General'}</td>
      <td><span class="badge ${methodColors[s.paymentMethod]||'badge-amber'}">${s.paymentMethod}</span></td>
      <td style="color:var(--text-muted)">${s.items} artículo(s)</td>
      <td class="mono" style="font-weight:700">${formatMoney(s.total)}</td>
      <td>
        ${s.discount>0 ? `<span class="badge badge-green" style="margin-right:4px">-${s.discount}%</span>` : ''}
      </td>
    </tr>
  `).join('');
}

// ESCÁNER DE CÓDIGO DE BARRAS (WEBCAM/MOBILE)
function openBarcodeScanner() {
  state.scannerTarget = 'pos';
  startScanner();
}

function openBarcodeScanForProduct() {
  state.scannerTarget = 'product';
  startScanner();
}

async function startScanner() {
  document.getElementById('scanner-modal').style.display = '';
  document.getElementById('scanner-result').textContent = '';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    state.scannerStream = stream;
    const video = document.getElementById('scanner-video');
    video.srcObject = stream;

    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code'] });
      state.scannerInterval = setInterval(async () => {
        try {
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0) {
            const code = barcodes[0].rawValue;
            document.getElementById('scanner-result').textContent = code;
            stopScannerStream();
            setTimeout(() => {
              closeScanner();
              if (state.scannerTarget === 'pos') {
                addByBarcode(code);
              } else {
                document.getElementById('prod-barcode').value = code;
              }
            }, 300);
          }
        } catch {}
      }, 300);
    } else {
      document.getElementById('scanner-result').textContent = 'El lector de cámara nativo no está disponible en tu navegador.';
    }
  } catch (e) {
    toast('No se pudo acceder a la cámara.', 'error');
    closeScanner();
  }
}

function stopScannerStream() {
  if (state.scannerInterval) { clearInterval(state.scannerInterval); state.scannerInterval = null; }
  if (state.scannerStream) {
    state.scannerStream.getTracks().forEach(t => t.stop());
    state.scannerStream = null;
  }
}

function closeScanner() {
  stopScannerStream();
  document.getElementById('scanner-modal').style.display = 'none';
}

// EXPORTACIÓN A CSV
function exportToCSV(filename, headers, rows) {
  const escapeCSV = (val) => `"${String(val).replace(/"/g, '""')}"`;
  
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(escapeCSV).join(','))
  ].join('\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
}

function exportData(type) {
  if (type === 'inventory') {
    const headers = ['ID', 'Código', 'Nombre', 'Categoría', 'Precio', 'Costo', 'Stock', 'Unidad'];
    const rows = state.products.map(p => [p.id, p.barcode, p.name, p.category, p.price, p.cost, p.stock, p.unit]);
    exportToCSV('Inventario', headers, rows);
  } else if (type === 'crm') {
    const headers = ['ID', 'Nombre', 'Teléfono', 'Email', 'Notas', 'Compras Totales', 'Monto Acumulado'];
    const rows = state.customers.map(c => [c.id, c.name, c.phone, c.email, c.notes, c.totalPurchases, c.totalAmount]);
    exportToCSV('Clientes', headers, rows);
  } else if (type === 'history') {
    const headers = ['ID Ticket', 'Fecha', 'Cliente', 'Método Pago', 'Total', 'Subtotal', 'Descuento %', 'Items'];
    const rows = state.sales.map(s => [s.id, s.date, s.customerName, s.paymentMethod, s.total, s.subtotal, s.discount, s.items]);
    exportToCSV('Ventas', headers, rows);
  }
}

// SETTINGS Y UTILIDADES
function openSettings() {
  document.getElementById('settings-biz').value = state.config.bizName;
  document.getElementById('settings-url').value = state.config.scriptUrl;
  document.getElementById('settings-currency').value = state.config.currency;
  document.getElementById('settings-min-stock').value = state.config.minStock;
  document.getElementById('settings-modal').style.display = '';
}

function saveSettings() {
  state.config.bizName = document.getElementById('settings-biz').value.trim() || 'Mi Tienda';
  state.config.scriptUrl = document.getElementById('settings-url').value.trim();
  state.config.currency = document.getElementById('settings-currency').value.trim() || 'MXN';
  state.config.minStock = parseInt(document.getElementById('settings-min-stock').value) || 5;
  saveLocal();
  
  document.getElementById('biz-name-display').textContent = state.config.bizName;
  closeModal('settings-modal');
  toast('Configuración guardada', 'success');
  
  renderInventory();
  renderPOSProducts();
}

function resetApp() {
  if (!confirm('¿Seguro que quieres resetear toda la aplicación? Se perderán todos los datos locales.')) return;
  [CONFIG_KEY, PRODUCTS_KEY, CUSTOMERS_KEY, SALES_KEY].forEach(k => localStorage.removeItem(k));
  location.reload();
}

function closeModal(id) { 
  document.getElementById(id).style.display = 'none'; 
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`; 
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function toggleKeypad() {
  const input = document.getElementById('barcode-input');
  if(!input) return;
  input.type = input.type === 'text' ? 'number' : 'text';
  input.focus();
}
// ═══════════════════════════════════════════════════════════════
// LOGIN Y ROLES
// ═══════════════════════════════════════════════════════════════
let currentPin = '';

function addPin(num) {
  if (currentPin.length < 4) currentPin += num;
  updatePinDisplay();
  if (currentPin.length === 4) setTimeout(attemptLogin, 200);
}

function clearPin() { 
  currentPin = ''; 
  updatePinDisplay(); 
}

function removePin() { 
  currentPin = currentPin.slice(0, -1); 
  updatePinDisplay(); 
}

function updatePinDisplay() {
  const dots = document.querySelectorAll('.pin-dot');
  dots.forEach((dot, i) => {
    if (i < currentPin.length) dot.classList.add('filled');
    else dot.classList.remove('filled');
  });
}

function attemptLogin() {
  // Backdoor de seguridad inicial por si la BD de usuarios está vacía
  if (state.users.length === 0 && currentPin === '1234') {
    handleLoginSuccess({ id: '0', name: 'Admin Maestro', role: 'admin' });
    return;
  }

  const user = state.users.find(u => String(u.pin) === currentPin && String(u.active) !== 'false');
  
  if (user) {
    handleLoginSuccess(user);
  } else {
    toast('PIN Incorrecto', 'error');
    clearPin();
  }
}

function handleLoginSuccess(user) {
  state.currentUser = user;
  document.getElementById('lock-screen').style.display = 'none';
  document.getElementById('main-app').style.display = '';
  
  // Actualizar perfil lateral
  const profileDisplay = document.getElementById('biz-name-display');
  profileDisplay.innerHTML = `${state.config.bizName} <br>
    <span style="color:var(--accent); cursor:pointer; display:inline-block; margin-top:4px;" onclick="logout()">
      👤 ${user.name} (${user.role}) [Salir]
    </span>`;
    
  applyRoles(user.role);
  switchPage('pos');
  toast(`Bienvenido, ${user.name}`, 'success');
  clearPin();
}

function logout() {
  state.currentUser = null;
  document.getElementById('main-app').style.display = 'none';
  document.getElementById('lock-screen').style.display = 'flex';
  clearPin();
}

function applyRoles(role) {
  const isCajero = role === 'cajero';
  // Esconder botones del menú lateral según el rol
  document.getElementById('nav-inventory').classList.toggle('hide-for-cajero', isCajero);
  document.getElementById('nav-crm').classList.toggle('hide-for-cajero', isCajero);
  document.getElementById('nav-users').classList.toggle('hide-for-cajero', isCajero);
  document.getElementById('nav-reports').classList.toggle('hide-for-cajero', isCajero);
  
  // Esconder botones de configuración general
  document.querySelector('.sidebar-footer').classList.toggle('hide-for-cajero', isCajero);
}
// ═══════════════════════════════════════════════════════════════
// GESTIÓN DE PERSONAL (USUARIOS)
// ═══════════════════════════════════════════════════════════════
function renderUsers() {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;
  
  if (!state.users.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><p>No hay usuarios registrados.</p></div></td></tr>';
    return;
  }
  
  tbody.innerHTML = state.users.map(u => `
    <tr>
      <td style="font-weight:600">${u.name} ${u.id === state.currentUser?.id ? '(Tú)' : ''}</td>
      <td class="mono">••••</td> <td><span class="badge ${u.role === 'admin' ? 'badge-blue' : 'badge-amber'}">${u.role.toUpperCase()}</span></td>
      <td><span class="badge ${String(u.active) !== 'false' ? 'badge-green' : 'badge-red'}">${String(u.active) !== 'false' ? 'Activo' : 'Inactivo'}</span></td>
      <td style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" onclick="openUserModal('${u.id}')">✏️</button>
        ${u.id !== state.currentUser?.id ? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}')">🗑</button>` : ''}
      </td>
    </tr>
  `).join('');
}

function openUserModal(id = null, isFirst = false) {
  state.editingUserId = id;
  const title = document.getElementById('user-modal-title');
  const firstMsg = document.getElementById('first-setup-msg');
  const closeBtn = document.getElementById('close-user-modal-btn');
  const cancelBtn = document.getElementById('cancel-user-modal-btn');
  const roleGroup = document.getElementById('user-role-group');

  if (isFirst) {
    title.textContent = 'Configuración Inicial';
    firstMsg.style.display = 'block';
    closeBtn.style.display = 'none'; // No puede cerrar hasta que cree el admin
    cancelBtn.style.display = 'none';
    roleGroup.style.display = 'none'; // El primero siempre es admin
    document.getElementById('user-role').value = 'admin';
    document.getElementById('user-name').value = '';
    document.getElementById('user-pin').value = '';
  } else if (id) {
    const u = state.users.find(u => u.id === id);
    title.textContent = 'Editar Usuario';
    firstMsg.style.display = 'none';
    closeBtn.style.display = ''; cancelBtn.style.display = ''; roleGroup.style.display = '';
    document.getElementById('user-name').value = u.name;
    document.getElementById('user-pin').value = u.pin;
    document.getElementById('user-role').value = u.role;
  } else {
    title.textContent = 'Nuevo Usuario';
    firstMsg.style.display = 'none';
    closeBtn.style.display = ''; cancelBtn.style.display = ''; roleGroup.style.display = '';
    document.getElementById('user-name').value = '';
    document.getElementById('user-pin').value = '';
    document.getElementById('user-role').value = 'cajero';
  }
  
  document.getElementById('user-modal').style.display = '';
}

async function saveUser() {
  const name = document.getElementById('user-name').value.trim();
  const pin = document.getElementById('user-pin').value.trim();
  const role = document.getElementById('user-role').value;
  
  if (!name || pin.length !== 4) { 
    toast('Ingresa un nombre y un PIN de 4 dígitos', 'error'); 
    return; 
  }

  // Prevenir PINs duplicados
  const pinExists = state.users.some(u => u.pin === pin && u.id !== state.editingUserId);
  if (pinExists) {
    toast('Este PIN ya está en uso por otro usuario', 'error');
    return;
  }

  const btn = document.getElementById('save-user-btn');
  btn.disabled = true; btn.textContent = 'Guardando...';

  const user = {
    id: state.editingUserId || ('U' + Date.now()),
    name, pin, role, active: 'true'
  };

  if (state.editingUserId) {
    const idx = state.users.findIndex(u => u.id === state.editingUserId);
    state.users[idx] = user;
    await apiCall({ action: 'updateRow', tab: 'Usuarios', idField: 'id', idValue: user.id, updates: user });
    toast('Usuario actualizado', 'success');
  } else {
    state.users.push(user);
    await apiCall({ action: 'write', tab: 'Usuarios', rows: [user] });
    toast('Usuario creado', 'success');
  }

  saveLocal();
  closeModal('user-modal');
  renderUsers();
  btn.disabled = false; btn.textContent = 'Guardar Usuario';

  // Si era la configuración inicial, mándalo a loguearse
  if (state.isFirstSetup) {
    state.isFirstSetup = false;
    showApp(); // Esto lo mandará al lock-screen
    toast('¡Todo listo! Inicia sesión con tu nuevo PIN', 'success');
  }
}

async function deleteUser(id) {
  if (!confirm('¿Eliminar este usuario? Ya no podrá ingresar al sistema.')) return;
  state.users = state.users.filter(u => u.id !== id);
  saveLocal();
  renderUsers();
  await apiCall({ action: 'deleteRow', tab: 'Usuarios', idField: 'id', idValue: id });
  toast('Usuario eliminado', 'success');
}

// Llama a renderUsers dentro de switchPage cuando entras a la vista
const originalSwitchPage = switchPage;
switchPage = function(page) {
  originalSwitchPage(page);
  if (page === 'users') renderUsers();
}
