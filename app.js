// Global state
let allLeads = [];
let filteredLeads = [];
let activeTab = 'overview';
let charts = {};
let currentSort = { column: 'Created on', direction: 'desc' };
let currentPage = 1;
const rowsPerPage = 12;
let rfqGranularity = 'monthly';
let selectedRFQInterval = null;
let selectedRFQClosureInterval = null;
let rfqClosuresGranularity = 'monthly';
let executiveClosuresGranularity = 'monthly';
let executiveClosuresGrainFilter = 'all';
let executiveClosuresCheckedValues = [];
let rfqAvgTurnaround = 27;
let activeCurrency = 'INR';
let usdToInrRate = 83.0; // 1 USD = 83 INR (fallback rate)
let selectedLeadForModal = null;

const VALID_TABS = ['overview', 'pipeline', 'team', 'geo', 'rfq', 'explorer', 'ai'];

function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'flex';
        if (!history.state || history.state.modalId !== modalId) {
            history.pushState({ tab: activeTab, modalId: modalId }, '', window.location.hash || '#' + activeTab);
        }
    }
}

function hideModal(modalId, isPopState = false) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
        if (!isPopState) {
            if (history.state && history.state.modalId === modalId) {
                history.back();
            }
        }
    }
}

window.addEventListener('popstate', (e) => {
    console.log('popstate event fired. State:', e.state, 'Location Hash:', window.location.hash);
    const state = e.state;
    const activeModalId = state && state.modalId;
    
    // Close modals that shouldn't be open
    ['lead-details-modal', 'api-modal', 'leads-list-modal'].forEach(id => {
        if (id !== activeModalId) {
            hideModal(id, true);
        }
    });
    
    // Open modal if specified in the state
    if (activeModalId) {
        showModal(activeModalId);
    }
    
    // Switch tab
    if (state && state.tab && VALID_TABS.includes(state.tab)) {
        switchTab(state.tab, true, false); // preventReset = true, pushState = false
    } else {
        const hash = window.location.hash.replace('#', '');
        if (VALID_TABS.includes(hash)) {
            switchTab(hash, true, false);
        }
    }
});


// Fetch exchange rate from API
async function fetchExchangeRate() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 seconds timeout
    
    try {
        const response = await fetch('https://open.er-api.com/v6/latest/USD', { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (data && data.rates && data.rates.INR) {
            usdToInrRate = parseFloat(data.rates.INR) || 83.0;
            console.log(`Successfully fetched live USD/INR exchange rate: ${usdToInrRate}`);
            updateLiveRateBadge(true);
        } else {
            throw new Error('Exchange rate for INR not found in API response');
        }
    } catch (error) {
        clearTimeout(timeoutId);
        console.warn('Failed to fetch live exchange rate, using fallback rate of 83:', error);
        usdToInrRate = 83.0;
        updateLiveRateBadge(false);
    }
}

function updateLiveRateBadge(isLive) {
    const rateTextEl = document.getElementById('rate-text');
    const dotEl = document.getElementById('rate-status-dot');
    if (rateTextEl && dotEl) {
        rateTextEl.textContent = `Rate: $1 = ₹${usdToInrRate.toFixed(2)}`;
        if (isLive) {
            dotEl.className = 'rate-status-dot live';
            dotEl.parentNode.setAttribute('title', 'Live USD to INR Exchange Rate (Fetched via API)');
        } else {
            dotEl.className = 'rate-status-dot fallback';
            dotEl.parentNode.setAttribute('title', 'Fallback USD to INR Exchange Rate (API offline/CORS blocked)');
        }
    }
}

// Load data on page load
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    try {
        // Fetch live exchange rate from API
        await fetchExchangeRate();

        const response = await fetch('leads_data.json?t=' + new Date().getTime());
        if (!response.ok) {
            throw new Error('Failed to load leads_data.json');
        }
        allLeads = await response.json();
        
        // Clean some values
        allLeads.forEach(lead => {
            lead['Expected Revenue'] = parseFloat(lead['Expected Revenue']) || 0;
            lead['Revenue (Millions USD)'] = parseFloat(lead['Revenue (Millions USD)']) || 0;
            // Clean Salesperson if null
            if (!lead['Salesperson']) lead['Salesperson'] = 'Unassigned';
            if (!lead['Stage']) lead['Stage'] = 'Undefined';
            if (!lead['Opportunity Type']) lead['Opportunity Type'] = 'Other';
            if (!lead['Industry Segment']) lead['Industry Segment'] = 'Other';
            if (!lead['Country']) lead['Country'] = 'Unknown';
            if (!lead['State']) lead['State'] = 'Unknown';
            if (!lead['City']) lead['City'] = 'Unknown';
            if (!lead['Source']) lead['Source'] = 'Direct/Other';
        });

        // Set up filters dropdown options
        populateFilters();
        
        // Restore saved filter selections
        restoreFilters();
        
        let initialTab = 'overview';
        const hash = window.location.hash.replace('#', '');
        if (VALID_TABS.includes(hash)) {
            initialTab = hash;
        } else {
            const savedTab = localStorage.getItem('active_tab') || 'overview';
            if (VALID_TABS.includes(savedTab)) {
                initialTab = savedTab;
            }
        }
        activeTab = initialTab;

        // Apply filters (which will calculate KPIs, draw charts and render table)
        applyFilters();

        // Register event listeners
        registerEventListeners();
        
        // Initialize history state
        history.replaceState({ tab: initialTab }, '', '#' + initialTab);

        // Switch to the saved tab to initialize the charts and UI for it without resetting filters
        switchTab(initialTab, true, false);

    } catch (error) {
        console.error('Error initializing application:', error);
        alert('Could not load data. Please make sure leads_data.json exists in the project folder.');
    }
}

// Format numbers as currency (auto-scale: Billions, Millions, Thousands)
function formatCurrency(value) {
    let val = value;
    let symbol = '₹';
    
    if (activeCurrency === 'USD') {
        val = value / usdToInrRate;
        symbol = '$';
    }
    
    if (val >= 1e9) {
        return `${symbol}${(val / 1e9).toFixed(2)}B`;
    } else if (val >= 1e6) {
        return `${symbol}${(val / 1e6).toFixed(2)}M`;
    } else if (val >= 1e3) {
        return `${symbol}${(val / 1e3).toFixed(0)}K`;
    }
    return `${symbol}${val.toFixed(0)}`;
}

function getCurrencyDetails() {
    return {
        scale: activeCurrency === 'USD' ? (1e6 * usdToInrRate) : 1e6,
        symbol: activeCurrency === 'USD' ? '$' : '₹'
    };
}

// Map a state/country to a regional classification
function getRegionForState(state, country) {
    if (!country && !state) return 'Unknown / Other';
    
    const countryLower = (country || '').trim().toLowerCase();
    if (countryLower && countryLower !== 'india') {
        return 'International';
    }
    
    const s = (state || '').trim().toLowerCase();
    if (!s) {
        if (countryLower === 'india') {
            return 'Other India';
        }
        return 'Unknown / Other';
    }
    
    if (s.includes('delhi') || s.includes('haryana') || s.includes('uttar pradesh') || s.includes('up (in)') || 
        s.includes('punjab') || s.includes('rajasthan') || s.includes('himachal') || s.includes('jammu') || 
        s.includes('kashmir') || s.includes('uttarakhand') || s.includes('chandigarh') || s.includes('ladakh')) {
        return 'North India';
    }
    if (s.includes('karnataka') || s.includes('tamil nadu') || s.includes('telangana') || s.includes('kerala') || 
        s.includes('andhra pradesh') || s.includes('lakshadweep') || s.includes('puducherry') || s.includes('chennai') || s.includes('bangalore')) {
        return 'South India';
    }
    if (s.includes('maharashtra') || s.includes('gujarat') || s.includes('goa') || s.includes('daman') || s.includes('diu') || s.includes('dadra') || s.includes('mumbai') || s.includes('pune')) {
        return 'West India';
    }
    if (s.includes('madhya pradesh') || s.includes('chhattisgarh') || s.includes('mp (in)')) {
        return 'Central India';
    }
    if (s.includes('west bengal') || s.includes('bihar') || s.includes('jharkhand') || s.includes('odisha') || s.includes('orissa') || s.includes('kolkata')) {
        return 'East India';
    }
    if (s.includes('assam') || s.includes('sikkim') || s.includes('arunachal') || s.includes('manipur') || 
        s.includes('meghalaya') || s.includes('mizoram') || s.includes('nagaland') || s.includes('tripura')) {
        return 'Northeast India';
    }
    
    if (s.includes('(in)') || countryLower === 'india') {
        return 'Other India';
    }
    
    return 'International';
}

let currentModalLeads = [];
let modalSearchLeads = [];
let modalFilterType = '';
let modalFilterValue = '';

// Export leads shown in the popup modal to CSV
function exportModalCSV(leads, title) {
    if (!leads || leads.length === 0) {
        alert('No records to export.');
        return;
    }
    
    // Select headers
    const cols = ['Opportunity', 'Company Name', 'Contact Name', 'Salesperson', 'Stage', 'Opportunity Type', 'Expected Revenue', 'Created on', 'Won/Lost', 'Country', 'State', 'City'];
    
    // CSV Header row
    let csvContent = "data:text/csv;charset=utf-8," 
        + cols.map(c => `"${c.replace(/"/g, '""')}"`).join(",") + "\n";
        
    // CSV Data rows
    leads.forEach(lead => {
        const row = cols.map(c => {
            const val = lead[c] !== null && lead[c] !== undefined ? String(lead[c]) : '';
            return `"${val.replace(/"/g, '""')}"`;
        });
        csvContent += row.join(",") + "\n";
    });
    
    // Create download trigger
    const fileName = title.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_export';
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${fileName}_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Render the leads table inside the popup modal
function renderModalLeadsTable(leads) {
    const tbody = document.getElementById('modal-leads-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (leads.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="8" style="text-align:center; color: var(--text-muted); padding: 40px;">No matching records found.</td>`;
        tbody.appendChild(tr);
        return;
    }
    
    leads.forEach(lead => {
        const tr = document.createElement('tr');
        tr.className = 'clickable-row';
        
        let badgeClass = 'badge-pending';
        let badgeText = 'Pending';
        if (lead['Won/Lost'] === 'Won' || lead['Stage'] === 'Won') {
            badgeClass = 'badge-won';
            badgeText = 'Won';
        } else if (lead['Stage'] === 'Dropped') {
            badgeClass = 'badge-dropped';
            badgeText = 'Dropped';
        }
        
        const cleanDate = lead['Created on'] ? lead['Created on'].substring(0, 10) : 'N/A';
        const shortOppName = lead['Opportunity'] ? lead['Opportunity'].split(' - ')[0] : 'N/A';
        
        // Escape opportunity name for the onclick handler
        const escOppName = lead['Opportunity'].replace(/'/g, "\\'");
        
        tr.innerHTML = `
            <td><span class="clickable-opportunity" onclick="openLeadDetailsModal('${escOppName}')" title="${lead['Opportunity']}">${shortOppName}</span></td>
            <td><span style="font-weight:500;" title="${lead['Company Name']}">${lead['Company Name'] || 'N/A'}</span></td>
            <td>${lead['Salesperson'] || 'Unassigned'}</td>
            <td><span style="color:var(--color-blue); font-weight:500;">${lead['Stage']}</span></td>
            <td>${lead['Opportunity Type'] || 'N/A'}</td>
            <td class="num-col" style="font-weight:600;">${formatCurrency(lead['Expected Revenue'] || 0)}</td>
            <td>${cleanDate}</td>
            <td><span class="badge ${badgeClass}">${badgeText}</span></td>
        `;
        
        tbody.appendChild(tr);
    });
}

// Instead of switching to Data Explorer, open a popup modal with filtered leads list
function goToExplorerFilter(type, value) {
    console.log('goToExplorerFilter intercepted to show modal for type:', type, 'value:', value);
    
    // Clear search box in modal
    const searchInput = document.getElementById('modal-search');
    if (searchInput) searchInput.value = '';
    
    modalFilterType = type;
    modalFilterValue = value || '';
    
    // Determine title, subtitle and filter the leads
    let title = 'Leads List';
    let subtitle = '';
    let leads = [];
    
    if (type === 'total') {
        leads = [...filteredLeads];
        title = 'Total Leads';
        subtitle = `Showing all ${leads.length.toLocaleString()} leads matching current filters`;
    } else if (type === 'won') {
        leads = filteredLeads.filter(l => l['Won/Lost'] === 'Won');
        title = 'Won Leads';
        subtitle = `Showing all ${leads.length.toLocaleString()} won leads matching current filters`;
    } else if (type === 'stage') {
        leads = filteredLeads.filter(l => l['Stage'] === value);
        title = `Stage: ${value}`;
        subtitle = `Showing ${leads.length.toLocaleString()} leads currently in stage "${value}"`;
    } else if (type === 'salesperson') {
        leads = filteredLeads.filter(l => l['Salesperson'] === value);
        title = `Leads for ${value}`;
        subtitle = `Showing ${leads.length.toLocaleString()} leads assigned to ${value}`;
    } else if (type === 'salesperson-won') {
        leads = filteredLeads.filter(l => l['Salesperson'] === value && l['Won/Lost'] === 'Won');
        title = `Won Leads for ${value}`;
        subtitle = `Showing ${leads.length.toLocaleString()} won leads assigned to ${value}`;
    } else if (type === 'city') {
        leads = filteredLeads.filter(l => l['City'] === value);
        title = `Leads in ${value}`;
        subtitle = `Showing ${leads.length.toLocaleString()} leads located in ${value}`;
    } else {
        leads = [...filteredLeads];
        subtitle = `Showing ${leads.length.toLocaleString()} leads`;
    }
    
    currentModalLeads = leads;
    modalSearchLeads = leads;
    
    // Update titles in UI
    const modalTitleEl = document.getElementById('leads-list-modal-title');
    const modalSubtitleEl = document.getElementById('leads-list-modal-subtitle');
    if (modalTitleEl) modalTitleEl.textContent = title;
    if (modalSubtitleEl) modalSubtitleEl.textContent = subtitle;
    
    // Render the table
    renderModalLeadsTable(leads);
    
    // Show the modal
    showModal('leads-list-modal');
}

// Open Lead Details Modal and populate information
function openLeadDetailsModal(oppName) {
    const lead = allLeads.find(l => l['Opportunity'] === oppName);
    if (!lead) return;
    
    selectedLeadForModal = lead;
    
    // Populate simple elements
    document.getElementById('detail-opp-name').textContent = lead['Opportunity'] || 'N/A';
    document.getElementById('detail-company-name').textContent = lead['Company Name'] || 'N/A';
    document.getElementById('detail-revenue').textContent = formatCurrency(lead['Expected Revenue'] || 0);
    document.getElementById('detail-salesperson').textContent = lead['Salesperson'] || 'Unassigned';
    
    const cleanDate = lead['Created on'] ? lead['Created on'].substring(0, 10) : (lead['RFQ Date'] ? lead['RFQ Date'].substring(0, 10) : 'N/A');
    document.getElementById('detail-created-on').textContent = cleanDate;
    
    // Closed Date display
    const closedDateVal = lead['Closed Date'] || lead['Date Closed'];
    const closedGroup = document.getElementById('detail-closed-on-group');
    const closedEl = document.getElementById('detail-closed-on');
    if (closedGroup && closedEl) {
        if (closedDateVal) {
            closedGroup.style.display = 'block';
            closedEl.textContent = closedDateVal.substring(0, 10);
        } else {
            closedGroup.style.display = 'none';
            closedEl.textContent = 'N/A';
        }
    }

    // Expected Closing display
    const expGroup = document.getElementById('detail-expected-closing-group');
    const expEl = document.getElementById('detail-expected-closing');
    if (expGroup && expEl) {
        if (!['Won', 'Dropped'].includes(lead['Stage'])) {
            const expDate = getLeadExpectedClosingDate(lead);
            if (expDate) {
                expGroup.style.display = 'block';
                const isConfirmed = !!lead['Expected Closing'];
                const label = isConfirmed ? '' : ' (Projected)';
                expEl.textContent = expDate.toISOString().substring(0, 10) + label;
            } else {
                expGroup.style.display = 'none';
            }
        } else {
            expGroup.style.display = 'none';
        }
    }
    
    // Stage status formatting
    let statusSuffix = ' (Pending)';
    if (lead['Won/Lost'] === 'Won' || lead['Stage'] === 'Won') statusSuffix = ' (Won)';
    else if (lead['Stage'] === 'Dropped' || lead['Stage'] === 'Lost') statusSuffix = ' (Dropped)';
    document.getElementById('detail-stage-status').textContent = (lead['Stage'] || 'Open') + statusSuffix;
    
    // Contact Info
    const phone = lead['Phone'] || lead['Mobile'] || lead['Contact No'] || lead['Contact no'] || '';
    document.getElementById('detail-contact-name').textContent = lead['Contact Name'] || 'N/A';
    document.getElementById('detail-phone').textContent = phone || 'N/A';
    document.getElementById('detail-email').textContent = lead['Email'] || 'N/A';
    
    const locationParts = [lead['City'], lead['State'], lead['Country']].filter(Boolean);
    document.getElementById('detail-location').textContent = locationParts.join(', ') || 'N/A';
    
    // Mailto action pre-fill
    const emailLink = document.getElementById('btn-send-email-action');
    if (emailLink) {
        if (lead['Email']) {
            emailLink.style.display = 'inline-flex';
            const subject = `Sales Follow-up: ${lead['Opportunity']}`;
            const clientName = lead['Contact Name'] || 'Client';
            const body = `Hi ${clientName},\n\nHope you are doing well.\n\nI wanted to follow up on your interest in "${lead['Opportunity']}". Let us know a convenient time to connect.\n\nBest regards,\n${lead['Salesperson'] || 'Sales Team'}`;
            emailLink.href = `mailto:${lead['Email']}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        } else {
            emailLink.style.display = 'none';
        }
    }
    
    // Phone actions pre-fill
    const callLink = document.getElementById('btn-call-client');
    const waLink = document.getElementById('btn-whatsapp-client');
    
    if (phone) {
        const cleanPhone = phone.replace(/[^0-9]/g, '');
        
        if (callLink) {
            callLink.style.display = 'inline-flex';
            callLink.href = `tel:${phone}`;
        }
        if (waLink) {
            waLink.style.display = 'inline-flex';
            const waText = `Hi ${lead['Contact Name'] || 'Client'},\n\nFollowing up from Eb-BB Sales team regarding opportunity: ${lead['Opportunity']}. Let us know if we can connect.`;
            waLink.href = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waText)}`;
        }
    } else {
        if (callLink) callLink.style.display = 'none';
        if (waLink) waLink.style.display = 'none';
    }
    
    // Show Modal
    showModal('lead-details-modal');
}




// Populate filter dropdowns with unique options
function populateFilters() {
    const filterSelectors = {
        salesperson: { col: 'Salesperson', elementId: 'filter-salesperson' },
        stage: { col: 'Stage', elementId: 'filter-stage' },
        industry: { col: 'Industry Segment', elementId: 'filter-industry' },
        type: { col: 'Opportunity Type', elementId: 'filter-type' }
    };

    for (const [key, config] of Object.entries(filterSelectors)) {
        const selectElement = document.getElementById(config.elementId);
        
        // Get unique sorted values
        const uniqueValues = [...new Set(allLeads.map(lead => lead[config.col]))].sort();
        
        // Populate dropdown
        uniqueValues.forEach(val => {
            const option = document.createElement('option');
            option.value = val;
            option.textContent = val;
            selectElement.appendChild(option);
        });
    }
}

// Reset filter values in DOM, localStorage and apply new state
function resetFilters(skipApply = false) {
    const dropdowns = ['filter-salesperson', 'filter-stage', 'filter-industry', 'filter-type', 'filter-status', 'filter-rfq-value'];
    dropdowns.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = 'all';
    });
    const elPeriod = document.getElementById('filter-rfq-period');
    if (elPeriod) elPeriod.value = 'all';
    
    const globalSearchEl = document.getElementById('global-search');
    if (globalSearchEl) globalSearchEl.value = '';
    
    const elValueGroup = document.getElementById('filter-rfq-value-group');
    if (elValueGroup) elValueGroup.style.display = 'none';
    const elValueSelect = document.getElementById('filter-rfq-value');
    if (elValueSelect) {
        elValueSelect.innerHTML = '<option value="all">All</option>';
        elValueSelect.value = 'all';
    }
    
    // Reset executive closures selectors
    const elExecGrain = document.getElementById('executive-closures-grain');
    if (elExecGrain) elExecGrain.value = 'all';
    executiveClosuresGrainFilter = 'all';
    executiveClosuresCheckedValues = [];
    localStorage.setItem('executive_closures_grain_filter', 'all');
    localStorage.removeItem('executive_closures_checked_values');
    populateExecutiveClosuresMultiselect();

    // Reset currency
    activeCurrency = 'INR';
    localStorage.setItem('active_currency', 'INR');
    const btnInr = document.getElementById('btn-currency-inr');
    const btnUsd = document.getElementById('btn-currency-usd');
    if (btnInr && btnUsd) {
        btnInr.classList.add('active');
        btnInr.classList.remove('btn-secondary');
        btnUsd.classList.remove('active');
        btnUsd.classList.add('btn-secondary');
    }

    // Reset RFQ granularities
    rfqGranularity = 'monthly';
    rfqClosuresGranularity = 'monthly';
    localStorage.setItem('rfq_granularity', 'monthly');
    localStorage.setItem('rfq_closures_granularity', 'monthly');
    
    const rfqButtons = document.querySelectorAll('#rfq-grain-toggle button');
    rfqButtons.forEach(btn => {
        if (btn.getAttribute('data-grain') === 'monthly') btn.classList.add('active');
        else btn.classList.remove('active');
    });

    const closureButtons = document.querySelectorAll('#rfq-closures-grain-toggle button');
    if (closureButtons) {
        closureButtons.forEach(btn => {
            if (btn.getAttribute('data-grain') === 'monthly') btn.classList.add('active');
            else btn.classList.remove('active');
        });
    }
    
    localStorage.setItem('filter_salesperson', 'all');
    localStorage.setItem('filter_stage', 'all');
    localStorage.setItem('filter_industry', 'all');
    localStorage.setItem('filter_type', 'all');
    localStorage.setItem('filter_status', 'all');
    localStorage.setItem('filter_rfq_period', 'all');
    localStorage.setItem('filter_rfq_value', 'all');
    localStorage.setItem('filter_search', '');
    
    if (!skipApply) {
        applyFilters();
    }
}

// Switch active dashboard tab
function switchTab(tabName, preventReset = false, pushState = true) {
    console.log('switchTab called with tabName:', tabName, 'preventReset:', preventReset, 'pushState:', pushState);
    if (!preventReset) {
        resetFilters(true);
        filteredLeads = [...allLeads];
        currentPage = 1;
        updateKPIs();
    }

    const menuItems = document.querySelectorAll('.menu-item');
    const targetItem = Array.from(menuItems).find(mi => mi.getAttribute('data-tab') === tabName);
    if (!targetItem) return;
    
    // Toggle active state in sidebar
    menuItems.forEach(mi => mi.classList.remove('active'));
    targetItem.classList.add('active');
    
    activeTab = tabName;
    localStorage.setItem('active_tab', tabName);
    
    // Update hash and history state
    if (pushState) {
        if (window.location.hash !== '#' + tabName) {
            history.pushState({ tab: tabName }, '', '#' + tabName);
        }
    }
    
    // Update page headers
    const pageTitles = {
        overview: 'Executive Overview',
        pipeline: 'Pipeline Funnel Analysis',
        team: 'Sales Team Performance',
        geo: 'Geographic Distribution',
        rfq: 'RFQ Tracking',
        explorer: 'Leads Data Explorer',
        ai: 'AI Sales Assistant'
    };
    const titleEl = document.getElementById('page-title');
    if (titleEl && pageTitles[tabName]) {
        titleEl.textContent = pageTitles[tabName];
    }
    
    // Hide all tabs, show active one
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    const tabEl = document.getElementById(`tab-${tabName}`);
    if (tabEl) {
        tabEl.classList.add('active');
    }
    
    // Redraw/initialize charts & tables for the active tab
    updateCharts();
    renderTables();
    
    if (activeTab === 'ai') {
        updateAICardStats();
    }
}

// Restore saved filter values from localStorage
function restoreFilters() {
    const fields = [
        { id: 'filter-salesperson', key: 'filter_salesperson' },
        { id: 'filter-stage', key: 'filter_stage' },
        { id: 'filter-industry', key: 'filter_industry' },
        { id: 'filter-type', key: 'filter_type' },
        { id: 'filter-status', key: 'filter_status' }
    ];
    
    fields.forEach(f => {
        const el = document.getElementById(f.id);
        const val = localStorage.getItem(f.key);
        if (el && val !== null) {
            el.value = val;
        }
    });

    const searchEl = document.getElementById('global-search');
    const searchVal = localStorage.getItem('filter_search');
    if (searchEl && searchVal !== null) {
        searchEl.value = searchVal;
    }

    const elPeriod = document.getElementById('filter-rfq-period');
    const elValueGroup = document.getElementById('filter-rfq-value-group');
    const elValueSelect = document.getElementById('filter-rfq-value');
    
    const rfqPeriodVal = localStorage.getItem('filter_rfq_period');
    const rfqValueVal = localStorage.getItem('filter_rfq_value');

    if (elPeriod && rfqPeriodVal !== null) {
        elPeriod.value = rfqPeriodVal;
        
        if (rfqPeriodVal === 'all') {
            if (elValueGroup) elValueGroup.style.display = 'none';
            if (elValueSelect) {
                elValueSelect.innerHTML = '<option value="all">All</option>';
                elValueSelect.value = 'all';
            }
        } else {
            if (elValueGroup) elValueGroup.style.display = 'flex';
            
            let allText = 'All';
            if (rfqPeriodVal === 'daily') allText = 'All Days';
            else if (rfqPeriodVal === 'weekly') allText = 'All Weeks';
            else if (rfqPeriodVal === 'monthly') allText = 'All Months';
            else if (rfqPeriodVal === 'quarterly') allText = 'All Quarters';
            else if (rfqPeriodVal === 'annually') allText = 'All Years';
            
            const sortedLeadsForLabels = [...allLeads]
                .filter(lead => getLeadRFQDate(lead))
                .sort((a, b) => new Date(getLeadRFQDate(b)) - new Date(getLeadRFQDate(a)));

            const labels = [];
            sortedLeadsForLabels.forEach(lead => {
                const label = getLabelForRFQDate(getLeadRFQDate(lead), rfqPeriodVal);
                if (label && !labels.includes(label)) {
                    labels.push(label);
                }
            });
            
            if (elValueSelect) {
                let optionsHTML = `<option value="all">${allText}</option>`;
                labels.forEach(label => {
                    optionsHTML += `<option value="${label}">${label}</option>`;
                });
                elValueSelect.innerHTML = optionsHTML;
                
                if (rfqValueVal !== null) {
                    elValueSelect.value = rfqValueVal;
                } else {
                    elValueSelect.value = 'all';
                }
            }
        }
    }

    // Restore active currency toggle state
    const savedCurrency = localStorage.getItem('active_currency');
    if (savedCurrency !== null) {
        activeCurrency = savedCurrency;
        const btnInr = document.getElementById('btn-currency-inr');
        const btnUsd = document.getElementById('btn-currency-usd');
        if (btnInr && btnUsd) {
            if (activeCurrency === 'INR') {
                btnInr.classList.add('active');
                btnInr.classList.remove('btn-secondary');
                btnUsd.classList.remove('active');
                btnUsd.classList.add('btn-secondary');
            } else {
                btnUsd.classList.add('active');
                btnUsd.classList.remove('btn-secondary');
                btnInr.classList.remove('active');
                btnInr.classList.add('btn-secondary');
            }
        }
    }

    // Restore RFQ granularity
    const savedRfqGran = localStorage.getItem('rfq_granularity');
    if (savedRfqGran !== null) {
        rfqGranularity = savedRfqGran;
        const buttons = document.querySelectorAll('#rfq-grain-toggle button');
        buttons.forEach(btn => {
            if (btn.getAttribute('data-grain') === savedRfqGran) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    // Restore RFQ closures granularity
    const savedRfqClosuresGran = localStorage.getItem('rfq_closures_granularity');
    if (savedRfqClosuresGran !== null) {
        rfqClosuresGranularity = savedRfqClosuresGran;
        const closureButtons = document.querySelectorAll('#rfq-closures-grain-toggle button');
        if (closureButtons) {
            closureButtons.forEach(btn => {
                if (btn.getAttribute('data-grain') === savedRfqClosuresGran) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }
    }

    // Restore executive closures filter values
    const elExecGrain = document.getElementById('executive-closures-grain');
    const elExecContainer = document.getElementById('executive-closures-value-container');
    if (elExecGrain && elExecContainer) {
        const savedGrain = localStorage.getItem('executive_closures_grain_filter');
        if (savedGrain !== null) {
            elExecGrain.value = savedGrain;
            executiveClosuresGrainFilter = savedGrain;
            
            populateExecutiveClosuresMultiselect();
            
            const savedCheckedStr = localStorage.getItem('executive_closures_checked_values');
            if (savedCheckedStr !== null) {
                try {
                    executiveClosuresCheckedValues = JSON.parse(savedCheckedStr);
                    // Update checkboxes in DOM to match restored state
                    const checkboxes = document.querySelectorAll('.exec-closure-checkbox');
                    checkboxes.forEach(cb => {
                        cb.checked = executiveClosuresCheckedValues.includes(cb.value);
                    });
                    
                    const selectAllCb = document.getElementById('exec-select-all-checkbox');
                    if (selectAllCb) {
                        selectAllCb.checked = checkboxes.length > 0 && executiveClosuresCheckedValues.length === checkboxes.length;
                    }
                    
                    updateMultiselectLabel();
                } catch(e) {
                    console.error("Failed to parse saved checked values", e);
                }
            }
        }
    }
}

// Handle dynamic population of RFQ Period selector values
function handleRFQPeriodTypeChange() {
    const elPeriod = document.getElementById('filter-rfq-period');
    const elValueGroup = document.getElementById('filter-rfq-value-group');
    const elValueSelect = document.getElementById('filter-rfq-value');
    
    if (!elPeriod || !elValueGroup || !elValueSelect) return;
    
    const granularity = elPeriod.value;
    
    if (granularity === 'all') {
        elValueGroup.style.display = 'none';
        elValueSelect.innerHTML = '<option value="all">All</option>';
        elValueSelect.value = 'all';
    } else {
        elValueGroup.style.display = 'flex';
        
        let allText = 'All';
        if (granularity === 'daily') allText = 'All Days';
        else if (granularity === 'weekly') allText = 'All Weeks';
        else if (granularity === 'monthly') allText = 'All Months';
        else if (granularity === 'quarterly') allText = 'All Quarters';
        else if (granularity === 'annually') allText = 'All Years';
        
        // Extract unique labels based on rfq date descending
        const sortedLeadsForLabels = [...allLeads]
            .filter(lead => getLeadRFQDate(lead))
            .sort((a, b) => new Date(getLeadRFQDate(b)) - new Date(getLeadRFQDate(a)));

        const labels = [];
        sortedLeadsForLabels.forEach(lead => {
            const label = getLabelForRFQDate(getLeadRFQDate(lead), granularity);
            if (label && !labels.includes(label)) {
                labels.push(label);
            }
        });
        
        let optionsHTML = `<option value="all">${allText}</option>`;
        labels.forEach(label => {
            optionsHTML += `<option value="${label}">${label}</option>`;
        });
        elValueSelect.innerHTML = optionsHTML;
        elValueSelect.value = 'all';
    }
    
    applyFilters();
}

// Apply current filter selections to the dataset
function applyFilters() {
    console.log('applyFilters started...');
    selectedRFQInterval = null;
    
    const elSalesperson = document.getElementById('filter-salesperson');
    const elStage = document.getElementById('filter-stage');
    const elIndustry = document.getElementById('filter-industry');
    const elType = document.getElementById('filter-type');
    const elStatus = document.getElementById('filter-status');
    const elRFQPeriod = document.getElementById('filter-rfq-period');
    const elRFQValue = document.getElementById('filter-rfq-value');
    const searchEl = document.getElementById('global-search');
    
    const fSalesperson = elSalesperson ? elSalesperson.value : 'all';
    const fStage = elStage ? elStage.value : 'all';
    const fIndustry = elIndustry ? elIndustry.value : 'all';
    const fType = elType ? elType.value : 'all';
    const fStatus = elStatus ? elStatus.value : 'all';
    const fRFQPeriod = elRFQPeriod ? elRFQPeriod.value : 'all';
    const fRFQValue = elRFQValue ? elRFQValue.value : 'all';
    const searchQuery = searchEl ? searchEl.value.toLowerCase().trim() : '';

    // Save current selections to localStorage to persist across refreshes
    localStorage.setItem('filter_salesperson', fSalesperson);
    localStorage.setItem('filter_stage', fStage);
    localStorage.setItem('filter_industry', fIndustry);
    localStorage.setItem('filter_type', fType);
    localStorage.setItem('filter_status', fStatus);
    localStorage.setItem('filter_rfq_period', fRFQPeriod);
    localStorage.setItem('filter_rfq_value', fRFQValue);
    localStorage.setItem('filter_search', searchEl ? searchEl.value : '');

    filteredLeads = allLeads.filter(lead => {
        if (fSalesperson !== 'all' && lead['Salesperson'] !== fSalesperson) return false;
        if (fStage !== 'all' && lead['Stage'] !== fStage) return false;
        if (fIndustry !== 'all' && lead['Industry Segment'] !== fIndustry) return false;
        if (fType !== 'all' && lead['Opportunity Type'] !== fType) return false;
        if (fStatus !== 'all') {
            if (fStatus === 'Won' && lead['Won/Lost'] !== 'Won') return false;
            if (fStatus === 'Pending' && lead['Won/Lost'] === 'Won') return false;
        }
        
        if (fRFQPeriod !== 'all' && fRFQValue !== 'all') {
            const rfqDateStr = getLeadRFQDate(lead);
            if (!rfqDateStr) return false;
            if (getLabelForRFQDate(rfqDateStr, fRFQPeriod) !== fRFQValue) return false;
        }
        
        if (searchQuery) {
            const match = 
                (lead['Opportunity'] && lead['Opportunity'].toLowerCase().includes(searchQuery)) ||
                (lead['Company Name'] && lead['Company Name'].toLowerCase().includes(searchQuery)) ||
                (lead['Contact Name'] && lead['Contact Name'].toLowerCase().includes(searchQuery)) ||
                (lead['Email'] && lead['Email'].toLowerCase().includes(searchQuery)) ||
                (lead['Salesperson'] && lead['Salesperson'].toLowerCase().includes(searchQuery)) ||
                (lead['Stage'] && lead['Stage'].toLowerCase().includes(searchQuery)) ||
                (lead['Opportunity Type'] && lead['Opportunity Type'].toLowerCase().includes(searchQuery)) ||
                (lead['Country'] && lead['Country'].toLowerCase().includes(searchQuery)) ||
                (lead['State'] && lead['State'].toLowerCase().includes(searchQuery)) ||
                (lead['City'] && lead['City'].toLowerCase().includes(searchQuery));
            if (!match) return false;
        }
        return true;
    });

    // Reset pagination to first page
    currentPage = 1;

    // Update everything
    updateKPIs();
    updateCharts();
    renderTables();
    console.log('applyFilters finished. fStatus:', fStatus, 'filteredLeads length:', filteredLeads.length);
}

// Update dashboard KPI cards
function updateKPIs() {
    const totalLeads = filteredLeads.length;
    
    const totalExpectedRevenue = filteredLeads.reduce((sum, lead) => sum + lead['Expected Revenue'], 0);
    
    const wonDealsLeads = filteredLeads.filter(lead => lead['Won/Lost'] === 'Won');
    const wonDealsCount = wonDealsLeads.length;
    const wonValue = wonDealsLeads.reduce((sum, lead) => sum + lead['Expected Revenue'], 0);
    
    // Set values in HTML
    document.getElementById('kpi-total-leads').textContent = totalLeads.toLocaleString();
    document.getElementById('kpi-expected-revenue').textContent = formatCurrency(totalExpectedRevenue);
    document.getElementById('kpi-won-deals').textContent = wonDealsCount.toLocaleString();
    document.getElementById('kpi-won-value').textContent = formatCurrency(wonValue);

    if (activeTab === 'rfq') {
        updateRFQKPIs();
    }
}

// Chart.js helper to safely destroy and re-create charts
function renderChart(canvasId, config) {
    if (charts[canvasId]) {
        charts[canvasId].destroy();
    }
    const ctx = document.getElementById(canvasId).getContext('2d');
    charts[canvasId] = new Chart(ctx, config);
}

// Update all charts based on filtered data
function updateCharts() {
    const currDetails = getCurrencyDetails();
    const isDark = document.body.classList.contains('dark-theme');
    const textColor = isDark ? '#9ca3af' : '#64748b';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    const chartThemeOpts = {
        plugins: {
            legend: {
                labels: { color: textColor, font: { family: 'Outfit', size: 11 } }
            }
        },
        scales: {
            x: {
                grid: { color: gridColor },
                ticks: { color: textColor, font: { family: 'Outfit' } }
            },
            y: {
                grid: { color: gridColor },
                ticks: { color: textColor, font: { family: 'Outfit' } }
            }
        }
    };

    // 1. LEAD INFLOW & REVENUE TREND CHART (Overview Tab)
    if (activeTab === 'overview') {
        const monthlyData = {};
        
        filteredLeads.forEach(lead => {
            const dateStr = lead['Created on'];
            if (!dateStr) return;
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return;
            // Key format: YYYY-MM (e.g. "2026-05")
            const key = date.toISOString().substring(0, 7);
            if (!monthlyData[key]) {
                monthlyData[key] = { count: 0, revenue: 0 };
            }
            monthlyData[key].count += 1;
            monthlyData[key].revenue += lead['Expected Revenue'];
        });

        // Sort months chronologically
        const sortedMonths = Object.keys(monthlyData).sort();
        const monthLabels = sortedMonths.map(m => {
            const d = new Date(m + "-02"); // Add offset to avoid timezone shifts
            return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        });
        const currDetails = getCurrencyDetails();
        const counts = sortedMonths.map(m => monthlyData[m].count);
        const revenues = sortedMonths.map(m => monthlyData[m].revenue / currDetails.scale); // In Millions

        renderChart('chart-trend', {
            type: 'line',
            data: {
                labels: monthLabels,
                datasets: [
                    {
                        label: 'Lead Count (Left Axis)',
                        data: counts,
                        borderColor: '#0000ff',
                        backgroundColor: 'rgba(0, 0, 255, 0.1)',
                        borderWidth: 3,
                        tension: 0.35,
                        fill: true,
                        yAxisID: 'y'
                    },
                    {
                        label: `Expected Revenue in Millions (${activeCurrency}) (Right Axis)`,
                        data: revenues,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.05)',
                        borderWidth: 3,
                        tension: 0.35,
                        fill: true,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: textColor, font: { family: 'Outfit', size: 11 } }
                    }
                },
                scales: {
                    x: {
                        grid: { color: gridColor },
                        ticks: { color: textColor, font: { family: 'Outfit' } }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        grid: { color: gridColor },
                        ticks: { color: textColor, font: { family: 'Outfit' } }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        grid: { drawOnChartArea: false }, // Only show grid lines for left axis
                        ticks: {
                            color: textColor,
                            font: { family: 'Outfit' },
                            callback: function(value) { return currDetails.symbol + value.toFixed(1) + 'M'; }
                        }
                    }
                }
            }
        });
    }

    // 2. REVENUE BY PRODUCT TYPE (Overview Tab)
    if (activeTab === 'overview') {
        const typeData = {};
        filteredLeads.forEach(lead => {
            const t = lead['Opportunity Type'];
            typeData[t] = (typeData[t] || 0) + lead['Expected Revenue'];
        });

        const currDetails = getCurrencyDetails();
        const sortedTypes = Object.entries(typeData).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const labels = sortedTypes.map(x => x[0]);
        const data = sortedTypes.map(x => x[1] / currDetails.scale); // Millions

        renderChart('chart-type', {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: ['#0000ff', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899'],
                    borderWidth: isDark ? 2 : 1,
                    borderColor: isDark ? '#111827' : '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: textColor, font: { family: 'Outfit', size: 10 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return ` ${context.label}: ${currDetails.symbol}${context.raw.toFixed(1)}M`;
                            }
                        }
                    }
                }
            }
        });
    }

    // 3. SALES TEAM PERFORMANCE (Overview Tab)
    if (activeTab === 'overview') {
        const currDetails = getCurrencyDetails();
        const salesData = {};
        filteredLeads.forEach(lead => {
            const sp = lead['Salesperson'];
            salesData[sp] = (salesData[sp] || 0) + lead['Expected Revenue'];
        });

        const sortedSales = Object.entries(salesData).sort((a, b) => b[1] - a[1]);
        const labels = sortedSales.map(x => x[0]);
        const data = sortedSales.map(x => x[1] / currDetails.scale); // Millions

        renderChart('chart-salesperson', {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: `Expected Revenue in Millions (${activeCurrency})`,
                    data: data,
                    backgroundColor: '#8b5cf6',
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        grid: { color: gridColor },
                        ticks: { color: textColor, font: { family: 'Outfit' } }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: textColor, font: { family: 'Outfit', size: 11 } }
                    }
                }
            }
        });
    }

    // 4. DEALS & REVENUE BY STAGE (Overview Tab)
    if (activeTab === 'overview') {
        const currDetails = getCurrencyDetails();
        const stageData = {};
        filteredLeads.forEach(lead => {
            const st = lead['Stage'];
            if (!stageData[st]) {
                stageData[st] = { count: 0, revenue: 0 };
            }
            stageData[st].count += 1;
            stageData[st].revenue += lead['Expected Revenue'];
        });

        // Sort stages by count or revenue
        const sortedStages = Object.entries(stageData).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 8);
        const labels = sortedStages.map(x => x[0]);
        const counts = sortedStages.map(x => x[1].count);
        const revenues = sortedStages.map(x => x[1].revenue / currDetails.scale); // Millions

        renderChart('chart-stages', {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: `Total Expected Revenue in Millions (${activeCurrency})`,
                        data: revenues,
                        backgroundColor: '#0000ff',
                        borderRadius: 4,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Deals Count',
                        data: counts,
                        backgroundColor: '#ec4899',
                        borderRadius: 4,
                        yAxisID: 'y1',
                        type: 'line',
                        borderColor: '#ec4899',
                        borderWidth: 2,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { color: textColor, font: { family: 'Outfit', size: 11 } }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: textColor, font: { family: 'Outfit' } }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        grid: { color: gridColor },
                        ticks: { color: textColor, font: { family: 'Outfit' } }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        grid: { display: false },
                        ticks: { color: textColor, font: { family: 'Outfit' } }
                    }
                }
            }
        });
    }

    // 5. STAGE FUNNEL ANALYSIS (Pipeline Tab)
    if (activeTab === 'pipeline') {
        // Define exact workflow stages to order them logically
        const workflowOrder = [
            'Market Research',
            'Need Warm Intro',
            'Connected',
            'RFQ Expected',
            'RFQ Received',
            'Open',
            'Follow Up Later',
            'Won',
            'Dropped'
        ];
        
        const funnelData = {};
        workflowOrder.forEach(st => funnelData[st] = { count: 0, revenue: 0 });
        
        filteredLeads.forEach(lead => {
            const st = lead['Stage'];
            if (funnelData[st] !== undefined) {
                funnelData[st].count += 1;
                funnelData[st].revenue += lead['Expected Revenue'];
            } else {
                // If it's a stage not in the default order
                if (!funnelData[st]) {
                    funnelData[st] = { count: 0, revenue: 0 };
                }
                funnelData[st].count += 1;
                funnelData[st].revenue += lead['Expected Revenue'];
            }
        });

        // Filter out empty stages if any
        const sortedStages = Object.entries(funnelData).filter(x => x[1].count > 0 || x[1].revenue > 0);
        const labels = sortedStages.map(x => x[0]);
        const revenues = sortedStages.map(x => x[1].revenue / currDetails.scale); // In Millions
        const counts = sortedStages.map(x => x[1].count);

        renderChart('chart-funnel-stages', {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: `Total Expected Revenue in Millions (${activeCurrency})`,
                        data: revenues,
                        backgroundColor: 'rgba(0, 0, 255, 0.75)',
                        borderColor: '#0000ff',
                        borderWidth: 1.5,
                        borderRadius: 4,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Deals Count',
                        data: counts,
                        backgroundColor: 'rgba(245, 158, 11, 0.75)',
                        borderColor: '#f59e0b',
                        borderWidth: 1.5,
                        borderRadius: 4,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: textColor, font: { family: 'Outfit', size: 11 } }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: textColor, font: { family: 'Outfit', size: 11 } }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        grid: { color: gridColor },
                        ticks: {
                            color: textColor,
                            font: { family: 'Outfit' },
                            callback: function(v) { return currDetails.symbol + v + 'M'; }
                        }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        grid: { display: false },
                        ticks: { color: textColor, font: { family: 'Outfit' } }
                    }
                }
            }
        });
    }

    // 6. SALES TEAM DETAILED PERFORMANCE (Team Tab)
    if (activeTab === 'team') {
        const teamScorecard = {};
        
        filteredLeads.forEach(lead => {
            const sp = lead['Salesperson'];
            if (!teamScorecard[sp]) {
                teamScorecard[sp] = { total: 0, won: 0, revenue: 0, wonRevenue: 0 };
            }
            teamScorecard[sp].total += 1;
            teamScorecard[sp].revenue += lead['Expected Revenue'];
            if (lead['Won/Lost'] === 'Won') {
                teamScorecard[sp].won += 1;
                teamScorecard[sp].wonRevenue += lead['Expected Revenue'];
            }
        });

        const sortedTeam = Object.entries(teamScorecard).sort((a, b) => b[1].revenue - a[1].revenue);
        const labels = sortedTeam.map(x => x[0]);
        const pipelineVal = sortedTeam.map(x => x[1].revenue / currDetails.scale); // Millions
        const wonVal = sortedTeam.map(x => x[1].wonRevenue / currDetails.scale); // Millions

        renderChart('chart-team-performance', {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: `Total Expected Revenue in Millions (${activeCurrency})`,
                        data: pipelineVal,
                        backgroundColor: 'rgba(139, 92, 246, 0.4)',
                        borderColor: '#8b5cf6',
                        borderWidth: 1.5,
                        borderRadius: 4
                    },
                    {
                        label: `Won Value in Millions (${activeCurrency})`,
                        data: wonVal,
                        backgroundColor: '#10b981',
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: textColor, font: { family: 'Outfit', size: 11 } }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: textColor, font: { family: 'Outfit' } }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        grid: { color: gridColor },
                        ticks: {
                            color: textColor,
                            font: { family: 'Outfit' },
                            callback: function(v) { return currDetails.symbol + v + 'M'; }
                        }
                    }
                }
            }
        });

        // Lead Source Mix
        const sourceData = {};
        filteredLeads.forEach(lead => {
            const src = lead['Source'];
            sourceData[src] = (sourceData[src] || 0) + lead['Expected Revenue'];
        });
        const sortedSources = Object.entries(sourceData).sort((a, b) => b[1] - a[1]).slice(0, 6);
        
        renderChart('chart-team-sources', {
            type: 'polarArea',
            data: {
                labels: sortedSources.map(x => x[0]),
                datasets: [{
                    data: sortedSources.map(x => x[1] / currDetails.scale),
                    backgroundColor: [
                        'rgba(0, 0, 255, 0.65)',
                        'rgba(16, 185, 129, 0.65)',
                        'rgba(139, 92, 246, 0.65)',
                        'rgba(245, 158, 11, 0.65)',
                        'rgba(244, 63, 94, 0.65)',
                        'rgba(236, 72, 153, 0.65)'
                    ],
                    borderWidth: isDark ? 2 : 1,
                    borderColor: isDark ? '#111827' : '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: textColor, font: { family: 'Outfit', size: 10 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return ` ${context.label}: ${currDetails.symbol}${context.raw.toFixed(1)}M`;
                            }
                        }
                    }
                },
                scales: {
                    r: {
                        grid: { color: gridColor },
                        ticks: { display: false }
                    }
                }
            }
        });
    }

    // 7. GEOGRAPHIC CHARTS (Geography Tab)
    if (activeTab === 'geo') {
        const stateData = {};
        const countryData = {};
        const regionData = {};
        
        filteredLeads.forEach(lead => {
            const st = lead['State'] || 'Unknown';
            const cnt = lead['Country'] || 'Unknown';
            stateData[st] = (stateData[st] || 0) + lead['Expected Revenue'];
            countryData[cnt] = (countryData[cnt] || 0) + lead['Expected Revenue'];
            
            const r = getRegionForState(lead['State'], lead['Country']);
            regionData[r] = (regionData[r] || 0) + lead['Expected Revenue'];
        });

        // Top 8 States
        const sortedStates = Object.entries(stateData).sort((a, b) => b[1] - a[1]).slice(0, 8);
        renderChart('chart-geo-states', {
            type: 'bar',
            data: {
                labels: sortedStates.map(x => x[0]),
                datasets: [{
                    label: `Expected Revenue in Millions (${activeCurrency})`,
                    data: sortedStates.map(x => x[1] / currDetails.scale),
                    backgroundColor: 'rgba(0, 0, 255, 0.85)',
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        grid: { color: gridColor },
                        ticks: { color: textColor, font: { family: 'Outfit' } }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: textColor, font: { family: 'Outfit' } }
                    }
                }
            }
        });

        // Top Countries
        const sortedCountries = Object.entries(countryData).sort((a, b) => b[1] - a[1]).slice(0, 5);
        renderChart('chart-geo-countries', {
            type: 'doughnut',
            data: {
                labels: sortedCountries.map(x => x[0]),
                datasets: [{
                    data: sortedCountries.map(x => x[1] / currDetails.scale),
                    backgroundColor: ['#10b981', '#0000ff', '#8b5cf6', '#f59e0b', '#f43f5e'],
                    borderWidth: isDark ? 2 : 1,
                    borderColor: isDark ? '#111827' : '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: textColor, font: { family: 'Outfit', size: 10 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return ` ${context.label}: ${currDetails.symbol}${context.raw.toFixed(1)}M`;
                            }
                        }
                    }
                }
            }
        });

        // Region-wise Distribution
        const sortedRegions = Object.entries(regionData).sort((a, b) => b[1] - a[1]);
        renderChart('chart-geo-regions', {
            type: 'doughnut',
            data: {
                labels: sortedRegions.map(x => x[0]),
                datasets: [{
                    data: sortedRegions.map(x => x[1] / currDetails.scale),
                    backgroundColor: ['#8b5cf6', '#0000ff', '#10b981', '#f59e0b', '#f43f5e', '#06b6d4', '#ec4899', '#64748b'],
                    borderWidth: isDark ? 2 : 1,
                    borderColor: isDark ? '#111827' : '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: textColor, font: { family: 'Outfit', size: 10 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return ` ${context.label}: ${currDetails.symbol}${context.raw.toFixed(1)}M`;
                            }
                        }
                    }
                }
            }
        });
    }

    if (activeTab === 'rfq') {
        updateRFQCharts();
    }
}

// Render dynamic tables based on currently active tab
function renderTables() {
    // 0. OVERVIEW TAB - Hot Opportunities Table
    if (activeTab === 'overview') {
        const tbody = document.querySelector('#hot-opportunities-table tbody');
        if (tbody) {
            tbody.innerHTML = '';
            
            // Filter active open opportunities
            const activeOpenLeads = filteredLeads.filter(lead => {
                const isWon = lead['Won/Lost'] === 'Won' || lead['Stage'] === 'Won';
                const isLost = lead['Stage'] === 'Dropped' || lead['Stage'] === 'Lost' || lead['Won/Lost'] === 'Lost';
                return !isWon && !isLost;
            });
            
            // Update counter badge
            const countBadge = document.getElementById('hot-opps-count');
            if (countBadge) {
                countBadge.textContent = `${activeOpenLeads.length.toLocaleString()} Active Leads`;
            }

            const top20 = activeOpenLeads
                .sort((a, b) => b['Expected Revenue'] - a['Expected Revenue'])
                .slice(0, 20);

            if (top20.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--text-muted); padding:40px;">No active open opportunities found.</td></tr>`;
            } else {
                top20.forEach(lead => {
                    const tr = document.createElement('tr');
                    tr.className = 'clickable-row';
                    tr.setAttribute('onclick', `openLeadDetailsModal('${lead['Opportunity'].replace(/'/g, "\\'")}')`);
                    const cleanDate = lead['Created on'] ? lead['Created on'].substring(0, 10) : 'N/A';
                    const shortOppName = lead['Opportunity'] ? lead['Opportunity'].split(' - ')[0] : 'N/A';
                    
                    tr.innerHTML = `
                        <td><span class="clickable-opportunity" title="${lead['Opportunity']}">${shortOppName}</span></td>
                        <td><span style="font-weight:500;" title="${lead['Company Name']}">${lead['Company Name'] || 'N/A'}</span></td>
                        <td>${lead['Salesperson']}</td>
                        <td>${lead['Stage']}</td>
                        <td class="num-col" style="font-weight:600; color: var(--color-blue);">${formatCurrency(lead['Expected Revenue'])}</td>
                        <td>${cleanDate}</td>
                        <td><span class="badge badge-pending">Active</span></td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        }
        renderExecutivePOTimeline();
    }

    if (activeTab === 'rfq') {
        renderRFQTable();
    }

    // 1. PIPELINE TAB - Conversion Table
    if (activeTab === 'pipeline') {
        const stageSummary = {};
        
        filteredLeads.forEach(lead => {
            const st = lead['Stage'];
            if (!stageSummary[st]) {
                stageSummary[st] = { count: 0, revenue: 0 };
            }
            stageSummary[st].count += 1;
            stageSummary[st].revenue += lead['Expected Revenue'];
        });

        const tbody = document.querySelector('#pipeline-summary-table tbody');
        tbody.innerHTML = '';
        
        const totalCount = filteredLeads.length;
        
        Object.entries(stageSummary)
            .sort((a, b) => b[1].revenue - a[1].revenue)
            .forEach(([stage, data]) => {
                const tr = document.createElement('tr');
                const pct = totalCount > 0 ? (data.count / totalCount * 100).toFixed(1) + '%' : '0%';
                const avgVal = data.count > 0 ? formatCurrency(data.revenue / data.count) : formatCurrency(0);
                
                tr.innerHTML = `
                    <td><strong>${stage}</strong></td>
                    <td class="num-col"><span class="clickable-count" onclick="goToExplorerFilter('stage', '${stage.replace(/'/g, "\\'")}')">${data.count.toLocaleString()}</span></td>
                    <td class="num-col">${pct}</td>
                    <td class="num-col" style="color: var(--color-blue); font-weight: 600;">${formatCurrency(data.revenue)}</td>
                    <td class="num-col">${avgVal}</td>
                `;
                tbody.appendChild(tr);
            });
    }

    // 2. TEAM TAB - Sales Leaderboard
    if (activeTab === 'team') {
        const teamData = {};
        
        filteredLeads.forEach(lead => {
            const sp = lead['Salesperson'];
            if (!teamData[sp]) {
                teamData[sp] = { leads: 0, won: 0, revenue: 0, wonRevenue: 0 };
            }
            teamData[sp].leads += 1;
            teamData[sp].revenue += lead['Expected Revenue'];
            if (lead['Won/Lost'] === 'Won') {
                teamData[sp].won += 1;
                teamData[sp].wonRevenue += lead['Expected Revenue'];
            }
        });

        const tbody = document.querySelector('#salesperson-leaderboard tbody');
        tbody.innerHTML = '';

        Object.entries(teamData)
            .sort((a, b) => b[1].wonRevenue - a[1].wonRevenue)
            .forEach(([salesperson, data]) => {
                const tr = document.createElement('tr');
                const avgVal = data.leads > 0 ? formatCurrency(data.revenue / data.leads) : formatCurrency(0);
                
                tr.innerHTML = `
                    <td><strong>${salesperson}</strong></td>
                    <td class="num-col"><span class="clickable-count" onclick="goToExplorerFilter('salesperson', '${salesperson.replace(/'/g, "\\'")}')">${data.leads.toLocaleString()}</span></td>
                    <td class="num-col"><span class="clickable-count" onclick="goToExplorerFilter('salesperson-won', '${salesperson.replace(/'/g, "\\'")}')">${data.won.toLocaleString()}</span></td>
                    <td class="num-col">${formatCurrency(data.revenue)}</td>
                    <td class="num-col" style="color: var(--color-emerald); font-weight: 600;">${formatCurrency(data.wonRevenue)}</td>
                    <td class="num-col">${avgVal}</td>
                `;
                tbody.appendChild(tr);
            });
    }

    // 3. GEOGRAPHY TAB - Cities Summary
    if (activeTab === 'geo') {
        const cityData = {};
        
        filteredLeads.forEach(lead => {
            const key = `${lead['City']}||${lead['State']}||${lead['Country']}`;
            if (!cityData[key]) {
                cityData[key] = { count: 0, revenue: 0 };
            }
            cityData[key].count += 1;
            cityData[key].revenue += lead['Expected Revenue'];
        });

        const tbody = document.querySelector('#geo-city-table tbody');
        tbody.innerHTML = '';

        Object.entries(cityData)
            .sort((a, b) => b[1].revenue - a[1].revenue)
            .slice(0, 15) // Top 15 cities
            .forEach(([key, data]) => {
                const [city, state, country] = key.split('||');
                const tr = document.createElement('tr');
                const avgVal = data.count > 0 ? formatCurrency(data.revenue / data.count) : formatCurrency(0);
                
                tr.innerHTML = `
                    <td><strong>${city}</strong></td>
                    <td>${state}</td>
                    <td>${country}</td>
                    <td class="num-col"><span class="clickable-count" onclick="goToExplorerFilter('city', '${city.replace(/'/g, "\\'")}')">${data.count.toLocaleString()}</span></td>
                    <td class="num-col" style="color: var(--color-blue); font-weight:600;">${formatCurrency(data.revenue)}</td>
                    <td class="num-col">${avgVal}</td>
                `;
                tbody.appendChild(tr);
            });
    }

    // 4. EXPLORER TAB - Main Data Table
    if (activeTab === 'explorer') {
        const tbody = document.getElementById('explorer-table-body');
        tbody.innerHTML = '';
        
        let explorerData = filteredLeads;

        // Apply column sorting
        explorerData.sort((a, b) => {
            let valA = a[currentSort.column];
            let valB = b[currentSort.column];

            // Handle numeric / date comparisons
            if (currentSort.column === 'Expected Revenue') {
                valA = parseFloat(valA) || 0;
                valB = parseFloat(valB) || 0;
            } else {
                valA = valA ? valA.toString().toLowerCase() : '';
                valB = valB ? valB.toString().toLowerCase() : '';
            }

            if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
            if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
            return 0;
        });

        // Setup Pagination bounds
        const totalRecords = explorerData.length;
        const totalPages = Math.ceil(totalRecords / rowsPerPage) || 1;
        
        if (currentPage > totalPages) currentPage = totalPages;
        
        const startIndex = (currentPage - 1) * rowsPerPage;
        const endIndex = Math.min(startIndex + rowsPerPage, totalRecords);

        // Update pagination details
        document.getElementById('pagination-info').textContent = totalRecords > 0 
            ? `Showing ${startIndex + 1} to ${endIndex} of ${totalRecords.toLocaleString()} entries`
            : `Showing 0 to 0 of 0 entries`;
            
        document.getElementById('current-page-display').textContent = currentPage;
        document.getElementById('btn-prev-page').disabled = currentPage === 1;
        document.getElementById('btn-next-page').disabled = currentPage === totalPages || totalRecords === 0;

        // Render subset of data for current page
        const pageData = explorerData.slice(startIndex, endIndex);
        
        if (pageData.length === 0) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td colspan="8" style="text-align:center; color: var(--text-muted); padding: 40px;">No matching records found. Try adjusting filters or search.</td>`;
            tbody.appendChild(tr);
            return;
        }

        pageData.forEach(lead => {
            const tr = document.createElement('tr');
            
            // Format Badge
            let badgeClass = 'badge-pending';
            let badgeText = 'Pending';
            
            if (lead['Won/Lost'] === 'Won' || lead['Stage'] === 'Won') {
                badgeClass = 'badge-won';
                badgeText = 'Won';
            } else if (lead['Stage'] === 'Dropped') {
                badgeClass = 'badge-dropped';
                badgeText = 'Dropped';
            }
            
            const cleanDate = lead['Created on'] ? lead['Created on'].substring(0, 10) : 'N/A';
            const shortOppName = lead['Opportunity'] ? lead['Opportunity'].split(' - ')[0] : 'N/A';

            tr.innerHTML = `
                <td><span class="clickable-opportunity" onclick="openLeadDetailsModal('${lead['Opportunity'].replace(/'/g, "\\'")}')" title="${lead['Opportunity']}">${shortOppName}</span></td>
                <td><span style="font-weight:500;" title="${lead['Company Name']}">${lead['Company Name'] || 'N/A'}</span></td>
                <td>${lead['Salesperson']}</td>
                <td><span style="color:var(--color-blue); font-weight:500;">${lead['Stage']}</span></td>
                <td>${lead['Opportunity Type']}</td>
                <td class="num-col" style="font-weight:600;">${formatCurrency(lead['Expected Revenue'])}</td>
                <td>${cleanDate}</td>
                <td><span class="badge ${badgeClass}">${badgeText}</span></td>
            `;
            tbody.appendChild(tr);
        });
    }
}

// 0b. OVERVIEW TAB - Executive PO Closures Milestone Timeline
function renderExecutivePOTimeline() {
    const timelineContainer = document.getElementById('executive-po-timeline');
    if (!timelineContainer) return;
    timelineContainer.innerHTML = '';

    // Dynamically update the specific period values select dropdown options
    populateExecutiveClosuresMultiselect();

    // Filter active RFQ leads (must have RFQ Date, stage not in Won, Dropped, Lost)
    const activeRFQs = filteredLeads.filter(lead => 
        getLeadRFQDate(lead) !== null && 
        !['Won', 'Dropped', 'Lost'].includes(lead['Stage'])
    );

    const refDate = new Date();
    refDate.setHours(0, 0, 0, 0); // Start of today

    // Map and calculate projected expected closing dates
    let upcomingList = activeRFQs.map(lead => {
        const isConfirmed = !!lead['Expected Closing'];
        const expDate = getLeadExpectedClosingDate(lead, rfqAvgTurnaround);
        return {
            lead: lead,
            expDate: expDate,
            isConfirmed: isConfirmed
        };
    })
    .filter(item => item.expDate !== null && item.expDate >= refDate);

    // Apply specific Date, Week, Month, Year filter
    if (executiveClosuresCheckedValues.length > 0) {
        upcomingList = upcomingList.filter(item => {
            let itemKey = '';
            if (executiveClosuresGrainFilter === 'all' || executiveClosuresGrainFilter === 'date') {
                itemKey = item.expDate.toISOString().substring(0, 10);
            } else if (executiveClosuresGrainFilter === 'week') {
                itemKey = getWeekKey(item.expDate);
            } else if (executiveClosuresGrainFilter === 'month') {
                itemKey = `${item.expDate.getFullYear()}-${(item.expDate.getMonth() + 1).toString().padStart(2, '0')}`;
            } else if (executiveClosuresGrainFilter === 'year') {
                itemKey = `${item.expDate.getFullYear()}`;
            }
            return executiveClosuresCheckedValues.includes(itemKey);
        });
    }

    upcomingList.sort((a, b) => a.expDate - b.expDate);

    if (upcomingList.length === 0) {
        timelineContainer.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 30px; border: 1px dashed var(--border-color); border-radius: var(--border-radius-md); width: 100%;">
                <i class="fa-solid fa-hourglass-empty" style="font-size: 24px; margin-bottom: 8px; color: var(--color-blue); display: block;"></i>
                <p style="margin: 0; font-size: 13px;">No upcoming PO closures projected for the active pipeline.</p>
            </div>
        `;
        return;
    }

    upcomingList.forEach(item => {
        const lead = item.lead;
        const isConfirmed = item.isConfirmed;
        const expDate = item.expDate;
        
        const shortOpp = lead['Opportunity'] ? lead['Opportunity'].split(' - ')[0] : 'N/A';
        const company = lead['Company Name'] || 'N/A';
        const revStr = formatCurrency(lead['Expected Revenue'] || 0);
        const dateStr = expDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const dateLabel = isConfirmed ? dateStr : `${dateStr} (Projected)`;
        
        // Initials for avatar
        const salesRep = lead['Salesperson'] || 'Unassigned';
        const initials = salesRep.split(' ').map(n => n[0]).join('').substring(0, 2);

        // Calculate progress percentage based on stage to give a visual UX
        let progress = 20;
        if (lead['Stage'] === 'Connected') progress = 40;
        else if (lead['Stage'] === 'RFQ Received') progress = 70;
        else if (lead['Stage'] === 'RFQ Expected') progress = 85;
        
        const cardClass = isConfirmed ? 'executive-milestone-card confirmed' : 'executive-milestone-card';

        const milestoneHTML = `
            <div class="${cardClass}" onclick="openLeadDetailsModal('${lead['Opportunity'].replace(/'/g, "\\'")}')">
                <span class="milestone-date-badge">${dateLabel}</span>
                <div>
                    <h4 class="milestone-opp" title="${lead['Opportunity']}">${shortOpp}</h4>
                    <p class="milestone-company">${company}</p>
                </div>
                <div class="milestone-revenue">${revStr}</div>
                
                <!-- Progress indicator for win probability/stage -->
                <div style="margin-top: 4px;">
                    <div style="display:flex; justify-content:space-between; font-size:9px; color: var(--text-muted); margin-bottom:3px;">
                        <span>Deal Stage</span>
                        <span>${progress}%</span>
                    </div>
                    <div style="width: 100%; height: 6px; background-color: var(--border-color); border-radius: 3px; overflow:hidden;">
                        <div style="width: ${progress}%; height: 100%; background-color: ${isConfirmed ? 'var(--color-emerald)' : 'var(--color-blue)'}; border-radius: 3px;"></div>
                    </div>
                </div>

                <div class="milestone-footer">
                    <div class="milestone-salesperson">
                        <div class="sales-avatar">${initials}</div>
                        <span>${salesRep}</span>
                    </div>
                    <span class="milestone-stage">${lead['Stage']}</span>
                </div>
            </div>
        `;
        timelineContainer.insertAdjacentHTML('beforeend', milestoneHTML);
    });
}

function populateExecutiveClosuresMultiselect() {
    const grainEl = document.getElementById('executive-closures-grain');
    const containerEl = document.getElementById('executive-closures-value-container');
    const dropdownEl = document.getElementById('executive-multiselect-dropdown');
    const labelEl = document.getElementById('executive-multiselect-label');
    if (!grainEl || !containerEl || !dropdownEl || !labelEl) return;

    containerEl.style.display = 'inline-block';
    const granularity = grainEl.value;

    const activeRFQs = filteredLeads.filter(lead => 
        getLeadRFQDate(lead) !== null && 
        !['Won', 'Dropped', 'Lost'].includes(lead['Stage'])
    );

    const refDate = new Date();
    refDate.setHours(0, 0, 0, 0);

    // Get expected dates
    const dates = activeRFQs.map(lead => getLeadExpectedClosingDate(lead, rfqAvgTurnaround))
        .filter(d => d !== null && d >= refDate);

    // Extract unique labels based on granularity
    const items = [];
    dates.forEach(d => {
        let key = '';
        let label = '';
        if (granularity === 'all' || granularity === 'date') {
            key = d.toISOString().substring(0, 10);
            label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } else if (granularity === 'week') {
            key = getWeekKey(d);
            label = key.replace('-W', ' Wk ');
        } else if (granularity === 'month') {
            key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
            label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        } else if (granularity === 'year') {
            key = `${d.getFullYear()}`;
            label = key;
        }

        if (key && !items.some(item => item.key === key)) {
            items.push({ key, label, dateObj: d });
        }
    });

    // Sort items by dateObj ascending
    items.sort((a, b) => a.dateObj - b.dateObj);

    // Read stored checked values if any, or default to all checked
    let savedCheckedStr = localStorage.getItem('executive_closures_checked_values');
    let savedGrain = localStorage.getItem('executive_closures_grain_filter');
    
    // If the grain has changed since last save, we reset the checked list to all of them
    if (savedGrain !== granularity) {
        savedCheckedStr = null;
    }
    
    let checkedKeys = [];
    if (savedCheckedStr !== null) {
        try {
            checkedKeys = JSON.parse(savedCheckedStr);
        } catch(e) {
            checkedKeys = items.map(it => it.key);
        }
    } else {
        checkedKeys = items.map(it => it.key);
    }
    
    // Filter out keys that do not exist in the new items list
    checkedKeys = checkedKeys.filter(k => items.some(it => it.key === k));
    
    // If empty (and items is not empty), default to checking everything
    if (checkedKeys.length === 0 && items.length > 0 && savedCheckedStr === null) {
        checkedKeys = items.map(it => it.key);
    }

    executiveClosuresCheckedValues = checkedKeys;
    localStorage.setItem('executive_closures_checked_values', JSON.stringify(executiveClosuresCheckedValues));

    // Populate dropdown HTML
    let dropdownHTML = '';
    
    // Add "Select All" option
    const allChecked = items.length > 0 && checkedKeys.length === items.length;
    dropdownHTML += `
        <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer; color: var(--text-primary); padding: 6px; border-radius: 4px; font-weight: 600; border-bottom: 1px solid var(--border-color); margin-bottom: 4px; box-sizing: border-box; width: 100%;">
            <input type="checkbox" id="exec-select-all-checkbox" ${allChecked ? 'checked' : ''} style="cursor: pointer;">
            <span>Select All</span>
        </label>
    `;

    items.forEach(item => {
        const isChecked = checkedKeys.includes(item.key);
        dropdownHTML += `
            <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer; color: var(--text-primary); padding: 4px 6px; border-radius: 4px; box-sizing: border-box; width: 100%;">
                <input type="checkbox" value="${item.key}" class="exec-closure-checkbox" ${isChecked ? 'checked' : ''} style="cursor: pointer;">
                <span>${item.label}</span>
            </label>
        `;
    });

    dropdownEl.innerHTML = dropdownHTML;

    // Update label text
    updateMultiselectLabel();
}

function updateMultiselectLabel() {
    const labelEl = document.getElementById('executive-multiselect-label');
    const checkboxes = document.querySelectorAll('.exec-closure-checkbox');
    if (!labelEl) return;

    const total = checkboxes.length;
    const checkedCount = executiveClosuresCheckedValues.length;

    if (total === 0) {
        labelEl.textContent = 'No Periods';
    } else if (checkedCount === total) {
        labelEl.textContent = 'All Periods';
    } else if (checkedCount === 0) {
        labelEl.textContent = 'None Selected';
    } else {
        labelEl.textContent = `${checkedCount} Selected`;
    }
}

// Set up UI interactions, search, sorting and sidebar clicks
function registerEventListeners() {
    // 1. Sidebar tab switching
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tabName = item.getAttribute('data-tab');
            switchTab(tabName);
        });
    });
    // 1b. Executive closures timeline granularity selectors
    const elExecGrain = document.getElementById('executive-closures-grain');
    const elExecValueContainer = document.getElementById('executive-closures-value-container');
    const multiselectBtn = document.getElementById('executive-multiselect-btn');
    const dropdownEl = document.getElementById('executive-multiselect-dropdown');

    if (elExecGrain) {
        elExecGrain.addEventListener('change', () => {
            executiveClosuresGrainFilter = elExecGrain.value;
            localStorage.setItem('executive_closures_grain_filter', executiveClosuresGrainFilter);
            localStorage.removeItem('executive_closures_checked_values'); // Reset checked selections on grain change
            renderExecutivePOTimeline();
        });
    }

    if (multiselectBtn && dropdownEl) {
        multiselectBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdownEl.style.display === 'flex';
            dropdownEl.style.display = isOpen ? 'none' : 'flex';
        });

        // Close dropdown when clicking outside
        window.addEventListener('click', () => {
            dropdownEl.style.display = 'none';
        });

        dropdownEl.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent closing dropdown when clicking inside it
        });

        // Delegate checkbox changes
        dropdownEl.addEventListener('change', (e) => {
            const target = e.target;
            if (target.id === 'exec-select-all-checkbox') {
                const checked = target.checked;
                const checkboxes = document.querySelectorAll('.exec-closure-checkbox');
                checkboxes.forEach(cb => {
                    cb.checked = checked;
                });
                
                if (checked) {
                    executiveClosuresCheckedValues = Array.from(checkboxes).map(cb => cb.value);
                } else {
                    executiveClosuresCheckedValues = [];
                }
                localStorage.setItem('executive_closures_checked_values', JSON.stringify(executiveClosuresCheckedValues));
                updateMultiselectLabel();
                renderExecutivePOTimeline();
            } else if (target.classList.contains('exec-closure-checkbox')) {
                const val = target.value;
                if (target.checked) {
                    if (!executiveClosuresCheckedValues.includes(val)) {
                        executiveClosuresCheckedValues.push(val);
                    }
                } else {
                    executiveClosuresCheckedValues = executiveClosuresCheckedValues.filter(v => v !== val);
                }
                
                // Update select all checkbox state
                const selectAllCb = document.getElementById('exec-select-all-checkbox');
                const checkboxes = document.querySelectorAll('.exec-closure-checkbox');
                if (selectAllCb) {
                    selectAllCb.checked = checkboxes.length > 0 && executiveClosuresCheckedValues.length === checkboxes.length;
                }
                
                localStorage.setItem('executive_closures_checked_values', JSON.stringify(executiveClosuresCheckedValues));
                updateMultiselectLabel();
                renderExecutivePOTimeline();
            }
        });
    }

    // 2. Dropdown Filter Selection triggers recalculations
    const dropdowns = ['filter-salesperson', 'filter-stage', 'filter-industry', 'filter-type', 'filter-status', 'filter-rfq-value'];
    dropdowns.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => {
                applyFilters();
            });
        }
    });

    const elPeriod = document.getElementById('filter-rfq-period');
    if (elPeriod) {
        elPeriod.addEventListener('change', () => {
            handleRFQPeriodTypeChange();
        });
    }

    // 3. Reset filters button
    const resetBtn = document.getElementById('reset-filters-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            resetFilters();
        });
    }

    // 4. Global Search Box typing triggers filtering
    const globalSearchEl = document.getElementById('global-search');
    if (globalSearchEl) {
        globalSearchEl.addEventListener('input', () => {
            currentPage = 1;
            applyFilters();
        });
    }

    // 5. Explorer Table Column Sorting click
    const headers = document.querySelectorAll('#main-data-table th[data-sort]');
    headers.forEach(th => {
        th.addEventListener('click', () => {
            const colName = th.getAttribute('data-sort');
            
            // Reset active headers arrow icons
            headers.forEach(h => {
                const icon = h.querySelector('i');
                if (icon) icon.className = 'fa-solid fa-sort';
            });
            
            if (currentSort.column === colName) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = colName;
                currentSort.direction = 'asc';
            }
            
            // Set active arrow icon
            const currentIcon = th.querySelector('i');
            if (currentIcon) {
                currentIcon.className = currentSort.direction === 'asc' 
                    ? 'fa-solid fa-sort-up' 
                    : 'fa-solid fa-sort-down';
            }
            
            renderTables();
        });
    });

    // 6. Pagination Buttons
    document.getElementById('btn-prev-page').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderTables();
        }
    });

    document.getElementById('btn-next-page').addEventListener('click', () => {
        currentPage++;
        renderTables();
    });

    // 7. Dark/Light Theme Toggle
    const themeBtn = document.getElementById('theme-toggle-btn');
    themeBtn.addEventListener('click', () => {
        const body = document.body;
        const themeText = document.getElementById('theme-text');
        const icon = themeBtn.querySelector('i');
        
        if (body.classList.contains('dark-theme')) {
            body.classList.replace('dark-theme', 'light-theme');
            themeText.textContent = 'Light Mode';
            icon.className = 'fa-solid fa-sun';
        } else {
            body.classList.replace('light-theme', 'dark-theme');
            themeText.textContent = 'Dark Mode';
            icon.className = 'fa-solid fa-moon';
        }
        
        // Refresh charts style colors
        updateCharts();
    });

    // 8. Download Filtered CSV Button
    document.getElementById('btn-export-csv').addEventListener('click', () => {
        exportFilteredCSV();
    });

    // 8.1 Currency Toggle Bindings
    const btnInr = document.getElementById('btn-currency-inr');
    const btnUsd = document.getElementById('btn-currency-usd');
    if (btnInr && btnUsd) {
        btnInr.addEventListener('click', () => {
            if (activeCurrency === 'INR') return;
            activeCurrency = 'INR';
            localStorage.setItem('active_currency', 'INR');
            btnInr.classList.add('active');
            btnInr.classList.remove('btn-secondary');
            btnUsd.classList.remove('active');
            btnUsd.classList.add('btn-secondary');
            
            updateKPIs();
            updateCharts();
            renderTables();
        });
        
        btnUsd.addEventListener('click', () => {
            if (activeCurrency === 'USD') return;
            activeCurrency = 'USD';
            localStorage.setItem('active_currency', 'USD');
            btnUsd.classList.add('active');
            btnUsd.classList.remove('btn-secondary');
            btnInr.classList.remove('active');
            btnInr.classList.add('btn-secondary');
            
            updateKPIs();
            updateCharts();
            renderTables();
        });
    }

    // 9. RFQ Granularity button bindings
    registerRFQEvents();

    // ==========================================
    // MOBILE RESPONSIVE LOGIC
    // ==========================================
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('app-sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const mobileFilterToggleBtn = document.getElementById('mobile-filter-toggle-btn');
    const filterBar = document.getElementById('app-filter-bar');

    // Toggle Sidebar Drawer
    if (mobileMenuBtn && sidebar && sidebarOverlay) {
        const toggleSidebar = () => {
            sidebar.classList.toggle('open');
            sidebarOverlay.classList.toggle('active');
        };

        const closeSidebar = () => {
            sidebar.classList.remove('open');
            sidebarOverlay.classList.remove('active');
        };

        mobileMenuBtn.addEventListener('click', toggleSidebar);
        sidebarOverlay.addEventListener('click', toggleSidebar);

        // Close button inside sidebar
        const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
        if (sidebarCloseBtn) {
            sidebarCloseBtn.addEventListener('click', closeSidebar);
        }

        // Close sidebar when clicking menu items on mobile
        const menuItems = document.querySelectorAll('.menu-item');
        menuItems.forEach(item => {
            item.addEventListener('click', () => {
                if (window.innerWidth <= 900) {
                    closeSidebar();
                }
            });
        });
    }

    // Toggle Filter Collapsible
    if (mobileFilterToggleBtn && filterBar) {
        mobileFilterToggleBtn.addEventListener('click', () => {
            filterBar.classList.toggle('expanded');
            
            // Change button content to reflect state
            if (filterBar.classList.contains('expanded')) {
                mobileFilterToggleBtn.innerHTML = '<i class="fa-solid fa-sliders"></i> Hide Filters';
            } else {
                mobileFilterToggleBtn.innerHTML = '<i class="fa-solid fa-sliders"></i> View & Apply Filters';
            }
        });
        
        // When reset filters is clicked, collapse filter bar on mobile
        const resetBtn = document.getElementById('reset-filters-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                if (window.innerWidth <= 900) {
                    filterBar.classList.remove('expanded');
                    mobileFilterToggleBtn.innerHTML = '<i class="fa-solid fa-sliders"></i> View & Apply Filters';
                }
            });
        }
    }
    
    // Clickable KPI totals to view in list view
    const cardTotalLeads = document.getElementById('card-total-leads');
    if (cardTotalLeads) {
        cardTotalLeads.title = "Click to view total leads list";
        cardTotalLeads.addEventListener('click', () => {
            goToExplorerFilter('total');
        });
    }

    const cardWonDeals = document.getElementById('card-won-deals');
    if (cardWonDeals) {
        cardWonDeals.title = "Click to view won leads list";
        cardWonDeals.addEventListener('click', () => {
            goToExplorerFilter('won');
        });
    }

    const cardWonValue = document.getElementById('card-won-value');
    if (cardWonValue) {
        cardWonValue.title = "Click to view won leads list";
        cardWonValue.addEventListener('click', () => {
            goToExplorerFilter('won');
        });
    }

    // Lead details modal close listener
    const btnCloseLead = document.getElementById('btn-close-lead-modal');
    const leadModal = document.getElementById('lead-details-modal');
    if (btnCloseLead && leadModal) {
        btnCloseLead.addEventListener('click', () => { hideModal('lead-details-modal'); });
        leadModal.addEventListener('click', (e) => {
            if (e.target === leadModal) hideModal('lead-details-modal');
        });
    }

    // Leads list modal event listeners
    const btnCloseLeadsList = document.getElementById('btn-close-leads-list-modal');
    const leadsListModal = document.getElementById('leads-list-modal');
    if (btnCloseLeadsList && leadsListModal) {
        btnCloseLeadsList.addEventListener('click', () => { hideModal('leads-list-modal'); });
        leadsListModal.addEventListener('click', (e) => {
            if (e.target === leadsListModal) hideModal('leads-list-modal');
        });
    }

    // Leads list modal search box
    const modalSearchInput = document.getElementById('modal-search');
    if (modalSearchInput) {
        modalSearchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (!query) {
                currentModalLeads = modalSearchLeads;
            } else {
                currentModalLeads = modalSearchLeads.filter(lead => {
                    const opp = (lead['Opportunity'] || '').toLowerCase();
                    const comp = (lead['Company Name'] || '').toLowerCase();
                    const sales = (lead['Salesperson'] || '').toLowerCase();
                    const stage = (lead['Stage'] || '').toLowerCase();
                    const type = (lead['Opportunity Type'] || '').toLowerCase();
                    const city = (lead['City'] || '').toLowerCase();
                    const state = (lead['State'] || '').toLowerCase();
                    const country = (lead['Country'] || '').toLowerCase();
                    
                    return opp.includes(query) || 
                           comp.includes(query) || 
                           sales.includes(query) || 
                           stage.includes(query) || 
                           type.includes(query) || 
                           city.includes(query) || 
                           state.includes(query) || 
                           country.includes(query);
                });
            }
            renderModalLeadsTable(currentModalLeads);
        });
    }

    // Leads list modal CSV export
    const btnModalExport = document.getElementById('btn-modal-export');
    if (btnModalExport) {
        btnModalExport.addEventListener('click', () => {
            const titleEl = document.getElementById('leads-list-modal-title');
            const title = titleEl ? titleEl.textContent : 'Leads_List';
            exportModalCSV(currentModalLeads, title);
        });
    }

    // Copy lead email listener
    const btnCopyEmail = document.getElementById('btn-copy-email');
    if (btnCopyEmail) {
        btnCopyEmail.addEventListener('click', () => {
            if (selectedLeadForModal && selectedLeadForModal['Email']) {
                navigator.clipboard.writeText(selectedLeadForModal['Email']);
                
                // Temporary button feedback
                const origText = btnCopyEmail.innerHTML;
                btnCopyEmail.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
                btnCopyEmail.style.borderColor = 'var(--color-emerald)';
                btnCopyEmail.style.color = 'var(--color-emerald)';
                setTimeout(() => {
                    btnCopyEmail.innerHTML = origText;
                    btnCopyEmail.style.borderColor = '';
                    btnCopyEmail.style.color = '';
                }, 2000);
            } else {
                alert('No email address available for this lead.');
            }
        });
    }

    // Copy Sales Sheet listener
    const btnCopySalesSheet = document.getElementById('btn-copy-sales-sheet');
    if (btnCopySalesSheet) {
        btnCopySalesSheet.addEventListener('click', () => {
            if (selectedLeadForModal) {
                const lead = selectedLeadForModal;
                const phone = lead['Phone'] || lead['Mobile'] || lead['Contact No'] || lead['Contact no'] || 'N/A';
                const locationParts = [lead['City'], lead['State'], lead['Country']].filter(Boolean);
                const salesSheetText = 
`=== EB-BB LEAD SALES SHEET ===
Opportunity: ${lead['Opportunity'] || 'N/A'}
Company: ${lead['Company Name'] || 'N/A'}
Expected Revenue: ${formatCurrency(lead['Expected Revenue'] || 0)}
Stage: ${lead['Stage'] || 'Open'} (${lead['Won/Lost'] || 'Pending'})
Salesperson: ${lead['Salesperson'] || 'Unassigned'}
Created On: ${lead['Created on'] || 'N/A'}

--- Client Contact Details ---
Contact Person: ${lead['Contact Name'] || 'N/A'}
Contact No: ${phone}
Email Address: ${lead['Email'] || 'N/A'}
Location: ${locationParts.join(', ') || 'N/A'}
==============================`;
                
                navigator.clipboard.writeText(salesSheetText);
                
                // Temporary button feedback
                const origText = btnCopySalesSheet.innerHTML;
                btnCopySalesSheet.innerHTML = '<i class="fa-solid fa-check"></i> Sheet Copied!';
                btnCopySalesSheet.style.borderColor = 'var(--color-emerald)';
                btnCopySalesSheet.style.color = 'var(--color-emerald)';
                setTimeout(() => {
                    btnCopySalesSheet.innerHTML = origText;
                    btnCopySalesSheet.style.borderColor = '';
                    btnCopySalesSheet.style.color = '';
                }, 2000);
            }
        });
    }

    // Close modals when Escape key is pressed
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const apiModal = document.getElementById('api-modal');
            if (apiModal && apiModal.style.display === 'flex') hideModal('api-modal');
            
            const leadModal = document.getElementById('lead-details-modal');
            if (leadModal && leadModal.style.display === 'flex') hideModal('lead-details-modal');
            
            const leadsListModal = document.getElementById('leads-list-modal');
            if (leadsListModal && leadsListModal.style.display === 'flex') hideModal('leads-list-modal');
        }
    });

    // Initialize AI Assistant
    initAIAssistant();
}

// Export filtered leads data to CSV
function exportFilteredCSV() {
    if (filteredLeads.length === 0) {
        alert('No records to export.');
        return;
    }
    
    // Select headers
    const cols = ['Opportunity', 'Company Name', 'Contact Name', 'Salesperson', 'Stage', 'Opportunity Type', 'Expected Revenue', 'Created on', 'Won/Lost', 'Country', 'State', 'City'];
    
    // CSV Header row
    let csvContent = "data:text/csv;charset=utf-8," 
        + cols.map(c => `"${c.replace(/"/g, '""')}"`).join(",") + "\n";
        
    // CSV Data rows
    filteredLeads.forEach(lead => {
        const row = cols.map(c => {
            const val = lead[c] !== null && lead[c] !== undefined ? String(lead[c]) : '';
            return `"${val.replace(/"/g, '""')}"`;
        });
        csvContent += row.join(",") + "\n";
    });
    
    // Create download trigger
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `eb_sales_pipeline_export_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==========================================
// RFQ TRACKING LOGIC & RENDERING
// ==========================================

function getLeadExpectedClosingDate(lead, avgDays = 27) {
    if (!lead) return null;
    
    // Dropped, Won, or Lost opportunities can never be expected to close in the future
    if (['Won', 'Dropped', 'Lost'].includes(lead['Stage'])) {
        return null;
    }
    
    if (lead['Expected Closing']) {
        return new Date(lead['Expected Closing']);
    }
    // For pending/active leads, we project based on RFQ Date or Created on
    const baseDateStr = lead['RFQ Date'] || lead['Created on'];
    if (baseDateStr) {
        const d = new Date(baseDateStr);
        if (!isNaN(d.getTime())) {
            d.setDate(d.getDate() + Math.round(avgDays));
            return d;
        }
    }
    return null;
}

function updateRFQKPIs() {
    const rfqLeads = filteredLeads.filter(lead => getLeadRFQDate(lead) !== null);
    const rfqCount = rfqLeads.length;
    const rfqRevenue = rfqLeads.reduce((sum, lead) => sum + lead['Expected Revenue'], 0);
    const rfqAvg = rfqCount > 0 ? (rfqRevenue / rfqCount) : 0;
    const rfqActive = rfqLeads.filter(lead => !['Won', 'Dropped'].includes(lead['Stage'])).length;

    document.getElementById('kpi-rfq-count').textContent = rfqCount.toLocaleString();
    document.getElementById('kpi-rfq-revenue').textContent = formatCurrency(rfqRevenue);
    document.getElementById('kpi-rfq-avg').textContent = formatCurrency(rfqAvg);
    document.getElementById('kpi-rfq-active').textContent = rfqActive.toLocaleString();

    // Calculate historical average turnaround days for won leads
    const wonLeads = filteredLeads.filter(lead => (lead['Won/Lost'] === 'Won' || lead['Stage'] === 'Won'));
    let totalDays = 0;
    let validPairs = 0;
    wonLeads.forEach(lead => {
        const rfqStr = lead['RFQ Date'];
        const closedStr = lead['Closed Date'] || lead['Date Closed'];
        if (rfqStr && closedStr) {
            const rfqD = new Date(rfqStr);
            const closedD = new Date(closedStr);
            if (!isNaN(rfqD.getTime()) && !isNaN(closedD.getTime())) {
                const diffTime = closedD - rfqD;
                const diffDays = diffTime / (1000 * 60 * 60 * 24);
                // Exclude anomalies (like negative values or > 365 days)
                if (diffDays >= 0 && diffDays < 365) {
                    totalDays += diffDays;
                    validPairs++;
                }
            }
        }
    });
    const avgTurnaround = validPairs > 0 ? (totalDays / validPairs) : 27; // Fallback to 27 days
    rfqAvgTurnaround = avgTurnaround;
    document.getElementById('kpi-rfq-turnaround-days').textContent = Math.round(avgTurnaround) + ' Days';

    // Calculate Expected Closures within the next 30 days
    const activeLeads = filteredLeads.filter(lead => !['Won', 'Dropped'].includes(lead['Stage']));
    const now = new Date();
    const refDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end30d = new Date(refDate.getTime() + 30 * 24 * 60 * 60 * 1000);

    let closuresValue = 0;
    let closuresCount = 0;

    activeLeads.forEach(lead => {
        const expDate = getLeadExpectedClosingDate(lead, avgTurnaround);
        if (expDate && expDate >= refDate && expDate <= end30d) {
            closuresValue += lead['Expected Revenue'] || 0;
            closuresCount++;
        }
    });

    document.getElementById('kpi-rfq-closures-value').textContent = formatCurrency(closuresValue);
    document.getElementById('kpi-rfq-closures-count').textContent = `${closuresCount} Deals`;
}

function updateRFQCharts() {
    const currDetails = getCurrencyDetails();
    const isDark = document.body.classList.contains('dark-theme');
    const textColor = isDark ? '#9ca3af' : '#64748b';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    
    const rfqLeads = filteredLeads.filter(lead => getLeadRFQDate(lead) !== null);

    // 1. RFQ Trend Chart
    const rfqTrendData = {};
    if (rfqLeads.length > 0) {
        // Find min and max dates
        let minDate = new Date(getLeadRFQDate(rfqLeads[0]));
        let maxDate = new Date(getLeadRFQDate(rfqLeads[0]));
        rfqLeads.forEach(lead => {
            const d = new Date(getLeadRFQDate(lead));
            if (d < minDate) minDate = d;
            if (d > maxDate) maxDate = d;
        });



        // Pre-populate all intervals in range with 0s
        if (rfqGranularity === 'daily') {
            const d = new Date(minDate.getTime());
            while (d <= maxDate) {
                const key = d.toISOString().substring(0, 10);
                rfqTrendData[key] = { count: 0, revenue: 0 };
                d.setDate(d.getDate() + 1);
            }
        } else if (rfqGranularity === 'weekly') {
            const d = new Date(minDate.getTime());
            // Align to start of week (Monday)
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1);
            d.setDate(diff);
            
            const maxTime = maxDate.getTime() + 7 * 86400000;
            while (d.getTime() <= maxTime) {
                const key = getWeekKey(d);
                rfqTrendData[key] = { count: 0, revenue: 0 };
                d.setDate(d.getDate() + 7);
            }
        } else if (rfqGranularity === 'monthly') {
            const d = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
            const end = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
            while (d <= end) {
                const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
                rfqTrendData[key] = { count: 0, revenue: 0 };
                d.setMonth(d.getMonth() + 1);
            }
        } else if (rfqGranularity === 'quarterly') {
            const startQ = Math.floor(minDate.getMonth() / 3) + 1;
            const endQ = Math.floor(maxDate.getMonth() / 3) + 1;
            let currYr = minDate.getFullYear();
            let currQ = startQ;
            const endYr = maxDate.getFullYear();
            while (currYr < endYr || (currYr === endYr && currQ <= endQ)) {
                const key = `${currYr}-Q${currQ}`;
                rfqTrendData[key] = { count: 0, revenue: 0 };
                currQ++;
                if (currQ > 4) {
                    currQ = 1;
                    currYr++;
                }
            }
        } else if (rfqGranularity === 'annual') {
            for (let yr = minDate.getFullYear(); yr <= maxDate.getFullYear(); yr++) {
                const key = `${yr}`;
                rfqTrendData[key] = { count: 0, revenue: 0 };
            }
        }

        // Fill in actual data points
        rfqLeads.forEach(lead => {
            const dateStr = getLeadRFQDate(lead);
            if (!dateStr) return;
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return;

            let key = '';
            if (rfqGranularity === 'daily') {
                key = dateStr.substring(0, 10);
            } else if (rfqGranularity === 'weekly') {
                key = getWeekKey(date);
            } else if (rfqGranularity === 'monthly') {
                key = dateStr.substring(0, 7);
            } else if (rfqGranularity === 'quarterly') {
                const quarter = Math.floor(date.getMonth() / 3) + 1;
                key = `${date.getFullYear()}-Q${quarter}`;
            } else if (rfqGranularity === 'annual') {
                key = `${date.getFullYear()}`;
            }

            if (rfqTrendData[key] !== undefined) {
                rfqTrendData[key].count += 1;
                rfqTrendData[key].revenue += lead['Expected Revenue'];
            }
        });
    }

    const sortedKeys = Object.keys(rfqTrendData).sort();
    
    const labelMapping = sortedKeys.map(k => {
        if (rfqGranularity === 'monthly') {
            const d = new Date(k + "-02");
            return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        }
        if (rfqGranularity === 'quarterly') {
            const [yr, q] = k.split('-');
            return `${q} ${yr}`;
        }
        if (rfqGranularity === 'weekly') {
            return k.replace('-W', ' Wk ');
        }
        return k;
    });

    const counts = sortedKeys.map(k => rfqTrendData[k].count);
    const revenues = sortedKeys.map(k => rfqTrendData[k].revenue / currDetails.scale); // In Millions

    renderChart('chart-rfq-trend', {
        type: 'bar',
        data: {
            labels: labelMapping,
            datasets: [
                {
                    label: 'RFQ Count (Left Axis)',
                    data: counts,
                    backgroundColor: 'rgba(0, 0, 255, 0.75)',
                    borderColor: '#0000ff',
                    borderWidth: 1,
                    borderRadius: 4,
                    yAxisID: 'y',
                    datalabels: {
                        display: true,
                        anchor: 'end',
                        align: 'top',
                        backgroundColor: '#0000ff',
                        color: '#ffffff',
                        borderRadius: 12,
                        padding: { top: 3, bottom: 3, left: 7, right: 7 },
                        font: { weight: 'bold', size: 10, family: 'Outfit' }
                    }
                },
                {
                    label: `RFQ Value in Millions (${activeCurrency}) (Right Axis)`,
                    data: revenues,
                    borderColor: '#10b981',
                    backgroundColor: 'transparent',
                    borderWidth: 3,
                    tension: 0.3,
                    type: 'line',
                    yAxisID: 'y1',
                    datalabels: {
                        display: false
                    }
                }
            ]
        },
        plugins: [ChartDataLabels],
        options: {
            onClick: (event, elements, chart) => {
                if (elements.length > 0) {
                    const firstElement = elements[0];
                    const dataIndex = firstElement.index;
                    const clickedLabel = chart.data.labels[dataIndex];
                    if (selectedRFQInterval === clickedLabel) {
                        selectedRFQInterval = null;
                    } else {
                        selectedRFQInterval = clickedLabel;
                    }
                    renderRFQTable();
                    if (selectedRFQInterval) {
                        const ledgerContainer = document.getElementById('rfq-ledger-container');
                        if (ledgerContainer) {
                            setTimeout(() => {
                                ledgerContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }, 80);
                        }
                    }
                }
            },
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    top: 15,
                    right: 15
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: textColor, font: { family: 'Outfit', size: 11 } }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: textColor, font: { family: 'Outfit' } }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { family: 'Outfit' } },
                    grace: '10%'
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { display: false },
                    ticks: {
                        color: textColor,
                        font: { family: 'Outfit' },
                        callback: function(v) { return currDetails.symbol + v + 'M'; }
                    }
                }
            }
        }
    });

    // 2. RFQ Type Breakdown
    const typeData = {};
    rfqLeads.forEach(lead => {
        const t = lead['Opportunity Type'];
        typeData[t] = (typeData[t] || 0) + lead['Expected Revenue'];
    });
    const sortedTypes = Object.entries(typeData).sort((a, b) => b[1] - a[1]);
    
    renderChart('chart-rfq-type', {
        type: 'doughnut',
        data: {
            labels: sortedTypes.map(x => x[0]),
            datasets: [{
                data: sortedTypes.map(x => x[1] / currDetails.scale),
                backgroundColor: ['#0000ff', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#f43f5e'],
                borderWidth: isDark ? 2 : 1,
                borderColor: isDark ? '#111827' : '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: textColor, font: { family: 'Outfit', size: 10 } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` ${context.label}: ${currDetails.symbol}${context.raw.toFixed(1)}M`;
                        }
                    }
                }
            }
        }
    });

    // 3. RFQs by Salesperson
    const salesData = {};
    rfqLeads.forEach(lead => {
        const sp = lead['Salesperson'];
        salesData[sp] = (salesData[sp] || 0) + 1;
    });
    const sortedSales = Object.entries(salesData).sort((a, b) => b[1] - a[1]);

    renderChart('chart-rfq-salesperson', {
        type: 'bar',
        plugins: [ChartDataLabels],
        data: {
            labels: sortedSales.map(x => x[0]),
            datasets: [{
                label: 'RFQs Handled',
                data: sortedSales.map(x => x[1]),
                backgroundColor: '#8b5cf6',
                borderRadius: 4,
                datalabels: {
                    display: true,
                    anchor: 'end',
                    align: 'right',
                    backgroundColor: '#8b5cf6',
                    color: '#ffffff',
                    borderRadius: 12,
                    padding: { top: 3, bottom: 3, left: 7, right: 7 },
                    font: { weight: 'bold', size: 10, family: 'Outfit' }
                }
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    right: 30
                }
            },
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { family: 'Outfit' } },
                    grace: '15%'
                },
                y: {
                    grid: { display: false },
                    ticks: { color: textColor, font: { family: 'Outfit', size: 11 } }
                }
            }
        }
    });

    // 4. RFQs by Territory (State)
    const stateData = {};
    rfqLeads.forEach(lead => {
        const st = lead['State'] || 'Unknown';
        stateData[st] = (stateData[st] || 0) + 1;
    });
    const sortedStates = Object.entries(stateData).sort((a, b) => b[1] - a[1]).slice(0, 6);

    renderChart('chart-rfq-geo', {
        type: 'bar',
        plugins: [ChartDataLabels],
        data: {
            labels: sortedStates.map(x => x[0]),
            datasets: [{
                label: 'RFQs Received',
                data: sortedStates.map(x => x[1]),
                backgroundColor: 'rgba(0, 0, 255, 0.85)',
                borderRadius: 4,
                datalabels: {
                    display: true,
                    anchor: 'end',
                    align: 'right',
                    backgroundColor: '#0000ff',
                    color: '#ffffff',
                    borderRadius: 12,
                    padding: { top: 3, bottom: 3, left: 7, right: 7 },
                    font: { weight: 'bold', size: 10, family: 'Outfit' }
                }
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    right: 30
                }
            },
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { family: 'Outfit' } },
                    grace: '15%'
                },
                y: {
                    grid: { display: false },
                    ticks: { color: textColor, font: { family: 'Outfit', size: 11 } }
                }
            }
        }
    });

    // 5. RFQs Conversion Status
    const statusCounts = { Won: 0, Pending: 0, Dropped: 0 };
    rfqLeads.forEach(lead => {
        if (lead['Won/Lost'] === 'Won' || lead['Stage'] === 'Won') {
            statusCounts.Won += 1;
        } else if (lead['Stage'] === 'Dropped') {
            statusCounts.Dropped += 1;
        } else {
            statusCounts.Pending += 1;
        }
    });

    renderChart('chart-rfq-status', {
        type: 'doughnut',
        data: {
            labels: ['Won', 'Pending', 'Dropped'],
            datasets: [{
                data: [statusCounts.Won, statusCounts.Pending, statusCounts.Dropped],
                backgroundColor: ['#10b981', '#0000ff', '#f43f5e'],
                borderWidth: isDark ? 2 : 1,
                borderColor: isDark ? '#111827' : '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: textColor, font: { family: 'Outfit', size: 11 } }
                }
            }
        }
    });

    // Calculate historical average turnaround days for won leads
    const wonLeads = filteredLeads.filter(lead => (lead['Won/Lost'] === 'Won' || lead['Stage'] === 'Won'));
    let totalDays = 0;
    let validPairs = 0;
    wonLeads.forEach(lead => {
        const rfqStr = lead['RFQ Date'];
        const closedStr = lead['Closed Date'] || lead['Date Closed'];
        if (rfqStr && closedStr) {
            const rfqD = new Date(rfqStr);
            const closedD = new Date(closedStr);
            if (!isNaN(rfqD.getTime()) && !isNaN(closedD.getTime())) {
                const diffTime = closedD - rfqD;
                const diffDays = diffTime / (1000 * 60 * 60 * 24);
                if (diffDays >= 0 && diffDays < 365) {
                    totalDays += diffDays;
                    validPairs++;
                }
            }
        }
    });
    const avgTurnaround = validPairs > 0 ? (totalDays / validPairs) : 27;

    // 6. Expected PO Closures Timeline (Dynamic forward-looking granularity)
    const closureIntervals = [];
    const closureData = {}; // key depends on granularity -> { confirmed: 0, projected: 0 }
    
    const nowTemp = new Date();
    const refDate = new Date(nowTemp.getFullYear(), nowTemp.getMonth(), nowTemp.getDate());

    if (rfqClosuresGranularity === 'daily') {
        // Generate next 30 days
        for (let i = 0; i < 30; i++) {
            const d = new Date(refDate.getTime() + i * 24 * 60 * 60 * 1000);
            const key = d.toISOString().substring(0, 10);
            closureIntervals.push({
                key: key,
                label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            });
            closureData[key] = { confirmed: 0, projected: 0 };
        }
    } else if (rfqClosuresGranularity === 'weekly') {
        // Generate next 12 weeks
        const d = new Date(refDate.getTime());
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        
        for (let i = 0; i < 12; i++) {
            const key = getWeekKey(d);
            closureIntervals.push({
                key: key,
                label: key.replace('-W', ' Wk ')
            });
            closureData[key] = { confirmed: 0, projected: 0 };
            d.setDate(d.getDate() + 7);
        }
    } else if (rfqClosuresGranularity === 'monthly') {
        // Generate next 6 months
        for (let i = 0; i < 6; i++) {
            const d = new Date(refDate.getFullYear(), refDate.getMonth() + i, 1);
            const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
            closureIntervals.push({
                key: key,
                label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
            });
            closureData[key] = { confirmed: 0, projected: 0 };
        }
    } else if (rfqClosuresGranularity === 'quarterly') {
        // Generate next 6 quarters
        let currYr = refDate.getFullYear();
        let currQ = Math.floor(refDate.getMonth() / 3) + 1;
        for (let i = 0; i < 6; i++) {
            const key = `${currYr}-Q${currQ}`;
            closureIntervals.push({
                key: key,
                label: `Q${currQ} ${currYr}`
            });
            closureData[key] = { confirmed: 0, projected: 0 };
            currQ++;
            if (currQ > 4) {
                currQ = 1;
                currYr++;
            }
        }
    } else if (rfqClosuresGranularity === 'annual') {
        // Generate next 3 years
        let startYr = refDate.getFullYear();
        for (let i = 0; i < 3; i++) {
            const key = `${startYr + i}`;
            closureIntervals.push({
                key: key,
                label: `${startYr + i}`
            });
            closureData[key] = { confirmed: 0, projected: 0 };
        }
    }

    // Filter active RFQ leads
    const activeRFQs = filteredLeads.filter(lead => getLeadRFQDate(lead) !== null && !['Won', 'Dropped'].includes(lead['Stage']));
    
    activeRFQs.forEach(lead => {
        const isConfirmed = !!lead['Expected Closing'];
        const expDate = getLeadExpectedClosingDate(lead, avgTurnaround);
        if (expDate) {
            let key = '';
            if (rfqClosuresGranularity === 'daily') {
                key = expDate.toISOString().substring(0, 10);
            } else if (rfqClosuresGranularity === 'weekly') {
                key = getWeekKey(expDate);
            } else if (rfqClosuresGranularity === 'monthly') {
                key = `${expDate.getFullYear()}-${(expDate.getMonth() + 1).toString().padStart(2, '0')}`;
            } else if (rfqClosuresGranularity === 'quarterly') {
                const quarter = Math.floor(expDate.getMonth() / 3) + 1;
                key = `${expDate.getFullYear()}-Q${quarter}`;
            } else if (rfqClosuresGranularity === 'annual') {
                key = `${expDate.getFullYear()}`;
            }

            if (closureData[key] !== undefined) {
                if (isConfirmed) {
                    closureData[key].confirmed += (lead['Expected Revenue'] || 0) / currDetails.scale;
                } else {
                    closureData[key].projected += (lead['Expected Revenue'] || 0) / currDetails.scale;
                }
            }
        }
    });

    const labelsClosures = closureIntervals.map(m => m.label);
    const confirmedValues = closureIntervals.map(m => closureData[m.key].confirmed);
    const projectedValues = closureIntervals.map(m => closureData[m.key].projected);

    renderChart('chart-rfq-closures-timeline', {
        type: 'bar',
        data: {
            labels: labelsClosures,
            datasets: [
                {
                    label: `Expected Closures (${activeCurrency})`,
                    data: confirmedValues,
                    backgroundColor: '#10b981', // Emerald
                    borderRadius: 4
                },
                {
                    label: `Projected (Turnaround Avg) (${activeCurrency})`,
                    data: projectedValues,
                    backgroundColor: 'rgba(0, 0, 255, 0.4)', // Semi-transparent blue
                    borderRadius: 4
                }
            ]
        },
        options: {
            onClick: (event, elements, chart) => {
                if (elements.length > 0) {
                    const firstElement = elements[0];
                    const dataIndex = firstElement.index;
                    const clickedLabel = chart.data.labels[dataIndex];
                    if (selectedRFQClosureInterval === clickedLabel) {
                        selectedRFQClosureInterval = null;
                    } else {
                        selectedRFQClosureInterval = clickedLabel;
                        selectedRFQInterval = null; // Clear standard RFQ Date filter to avoid conflict
                    }
                    renderRFQTable();
                    if (selectedRFQClosureInterval) {
                        const ledgerContainer = document.getElementById('rfq-ledger-container');
                        if (ledgerContainer) {
                            setTimeout(() => {
                                ledgerContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }, 80);
                        }
                    }
                }
            },
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: textColor, font: { family: 'Outfit', size: 10 } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` ${context.dataset.label}: ${currDetails.symbol}${context.raw.toFixed(2)}M`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    grid: { display: false },
                    ticks: { color: textColor, font: { family: 'Outfit' } }
                },
                y: {
                    stacked: true,
                    grid: { color: gridColor },
                    ticks: {
                        color: textColor,
                        font: { family: 'Outfit' },
                        callback: function(v) { return currDetails.symbol + v + 'M'; }
                    }
                }
            }
        }
    });

    // 7. Populate Upcoming Closures Table
    const tableBody = document.querySelector('#upcoming-closures-table tbody');
    if (tableBody) {
        tableBody.innerHTML = '';
        const now = new Date();
        const refDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        // Map active RFQs to their projected expected closing dates
        const upcomingList = activeRFQs.map(lead => {
            const isConfirmed = !!lead['Expected Closing'];
            const expDate = getLeadExpectedClosingDate(lead, avgTurnaround);
            return {
                lead: lead,
                expDate: expDate,
                isConfirmed: isConfirmed
            };
        })
        .filter(item => item.expDate !== null && item.expDate >= refDate)
        .sort((a, b) => a.expDate - b.expDate)
        .slice(0, 10); // Show top 10 upcoming closures

        if (upcomingList.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color: var(--text-muted); padding:20px;">No upcoming closures found.</td></tr>`;
        } else {
            upcomingList.forEach(item => {
                const tr = document.createElement('tr');
                const shortOpp = item.lead['Opportunity'] ? item.lead['Opportunity'].split(' - ')[0] : 'N/A';
                const dateStr = item.expDate.toISOString().substring(0, 10);
                const valStr = formatCurrency(item.lead['Expected Revenue'] || 0);
                const sourceBadge = item.isConfirmed 
                    ? `<span class="badge badge-won" style="font-size: 9px; padding: 2px 4px;">Expected</span>`
                    : `<span class="badge badge-pending" style="font-size: 9px; padding: 2px 4px; background-color: rgba(0, 0, 255, 0.1); color: var(--color-blue);">Projected</span>`;
                
                tr.innerHTML = `
                    <td><span class="clickable-opportunity" onclick="openLeadDetailsModal('${item.lead['Opportunity'].replace(/'/g, "\\'")}')" title="${item.lead['Opportunity']}" style="font-weight: 500;">${shortOpp}</span></td>
                    <td>${dateStr}</td>
                    <td class="num-col" style="font-weight: 600;">${valStr}</td>
                    <td style="text-align: center;">${sourceBadge}</td>
                `;
                tableBody.appendChild(tr);
            });
        }
    }
}

function renderRFQTable() {
    const tbody = document.querySelector('#rfq-ledger-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Update filter status UI
    const filterIndicator = document.getElementById('rfq-filter-indicator');
    const filterVal = document.getElementById('rfq-filter-val');
    if (selectedRFQInterval) {
        if (filterIndicator) filterIndicator.style.display = 'flex';
        if (filterVal) filterVal.textContent = `RFQ Date: ${selectedRFQInterval}`;
    } else if (selectedRFQClosureInterval) {
        if (filterIndicator) filterIndicator.style.display = 'flex';
        if (filterVal) filterVal.textContent = `Expected Closing: ${selectedRFQClosureInterval}`;
    } else {
        if (filterIndicator) filterIndicator.style.display = 'none';
    }

    let rfqLeads = filteredLeads.filter(lead => getLeadRFQDate(lead) !== null);
    
    // Apply chart click interval filter if set
    if (selectedRFQInterval) {
        rfqLeads = rfqLeads.filter(lead => {
            return getLabelForRFQDate(getLeadRFQDate(lead), rfqGranularity) === selectedRFQInterval;
        });
    }

    // Apply chart click expected closure interval filter if set
    if (selectedRFQClosureInterval) {
        rfqLeads = rfqLeads.filter(lead => {
            const expDate = getLeadExpectedClosingDate(lead, rfqAvgTurnaround);
            if (!expDate) return false;
            
            let label = '';
            if (rfqClosuresGranularity === 'daily') {
                label = expDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            } else if (rfqClosuresGranularity === 'weekly') {
                label = getWeekKey(expDate).replace('-W', ' Wk ');
            } else if (rfqClosuresGranularity === 'monthly') {
                label = expDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            } else if (rfqClosuresGranularity === 'quarterly') {
                const quarter = Math.floor(expDate.getMonth() / 3) + 1;
                label = `Q${quarter} ${expDate.getFullYear()}`;
            } else if (rfqClosuresGranularity === 'annual') {
                label = expDate.getFullYear().toString();
            }
            
            return label === selectedRFQClosureInterval;
        });
    }

    rfqLeads.sort((a, b) => new Date(getLeadRFQDate(b)) - new Date(getLeadRFQDate(a)));

    if (rfqLeads.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color: var(--text-muted); padding:30px;">No RFQs match filter settings.</td></tr>`;
        return;
    }

    rfqLeads.forEach(lead => {
        const tr = document.createElement('tr');
        
        let badgeClass = 'badge-pending';
        let badgeText = 'Pending';
        if (lead['Won/Lost'] === 'Won' || lead['Stage'] === 'Won') {
            badgeClass = 'badge-won';
            badgeText = 'Won';
        } else if (lead['Stage'] === 'Dropped') {
            badgeClass = 'badge-dropped';
            badgeText = 'Dropped';
        }

        const shortName = lead['Opportunity'] ? lead['Opportunity'].split(' - ')[0] : 'N/A';
        const cleanDate = lead['RFQ Date'] ? lead['RFQ Date'].substring(0, 10) : 'N/A';
        const closedDateVal = lead['Closed Date'] || lead['Date Closed'];
        const cleanClosedDate = closedDateVal ? closedDateVal.substring(0, 10) : '-';

        tr.innerHTML = `
            <td><span class="clickable-opportunity" onclick="openLeadDetailsModal('${lead['Opportunity'].replace(/'/g, "\\'")}')" title="${lead['Opportunity']}">${shortName}</span></td>
            <td>${lead['Company Name'] || 'N/A'}</td>
            <td>${lead['Salesperson']}</td>
            <td class="num-col">${cleanDate}</td>
            <td class="num-col">${cleanClosedDate}</td>
            <td class="num-col" style="font-weight:600;">${formatCurrency(lead['Expected Revenue'])}</td>
            <td><span style="color:var(--color-blue); font-weight:500;">${lead['Stage']}</span></td>
            <td><span class="badge ${badgeClass}">${badgeText}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

function registerRFQEvents() {
    const buttons = document.querySelectorAll('#rfq-grain-toggle button');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            rfqGranularity = btn.getAttribute('data-grain');
            localStorage.setItem('rfq_granularity', rfqGranularity);
            selectedRFQInterval = null; // Clear active chart filter on granularity switch
            updateRFQCharts();
            renderRFQTable();
        });
    });

    const closureButtons = document.querySelectorAll('#rfq-closures-grain-toggle button');
    if (closureButtons) {
        closureButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                closureButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                rfqClosuresGranularity = btn.getAttribute('data-grain');
                localStorage.setItem('rfq_closures_granularity', rfqClosuresGranularity);
                selectedRFQClosureInterval = null; // Clear active chart filter on granularity switch
                updateRFQCharts();
                renderRFQTable();
            });
        });
    }

    const clearBtn = document.getElementById('btn-clear-rfq-filter');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            selectedRFQInterval = null;
            selectedRFQClosureInterval = null;
            renderRFQTable();
        });
    }
}

// Helper: returns ISO week key (e.g. "2026-W24") for a given Date object
function getWeekKey(d) {
    const target = new Date(d.valueOf());
    const dayNr = (d.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
        target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    }
    const weekNum = 1 + Math.ceil((firstThursday - target) / 604800000);
    return `${d.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}

// Helper: returns the effective date for RFQ tracking (Win Date for won leads, RFQ Received Date otherwise)
function getLeadRFQDate(lead) {
    if (!lead) return null;
    if ((lead['Won/Lost'] === 'Won' || lead['Stage'] === 'Won') && (lead['Closed Date'] || lead['Date Closed'])) {
        return lead['Closed Date'] || lead['Date Closed'];
    }
    return lead['RFQ Date'];
}

// Helper: formats Odoo RFQ Date string into equivalent X-Axis label string
function getLabelForRFQDate(dateStr, granularity) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    
    if (granularity === 'daily') {
        return dateStr.substring(0, 10);
    } else if (granularity === 'weekly') {
        const target = new Date(date.valueOf());
        const dayNr = (date.getDay() + 6) % 7;
        target.setDate(target.getDate() - dayNr + 3);
        const firstThursday = target.valueOf();
        target.setMonth(0, 1);
        if (target.getDay() !== 4) {
            target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
        }
        const weekNum = 1 + Math.ceil((firstThursday - target) / 604800000);
        return `${date.getFullYear()} Wk ${weekNum.toString().padStart(2, '0')}`;
    } else if (granularity === 'monthly') {
        const d = new Date(dateStr.substring(0, 7) + "-02");
        return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    } else if (granularity === 'quarterly') {
        const quarter = Math.floor(date.getMonth() / 3) + 1;
        return `Q${quarter} ${date.getFullYear()}`;
    } else if (granularity === 'annual' || granularity === 'annually') {
        return `${date.getFullYear()}`;
    }
    return '';
}
// ==========================================
// AI ASSISTANT JS LOGIC
// ==========================================
let geminiApiKey = localStorage.getItem('gemini_api_key') || '';
let aiChatHistory = [];

// Initialize AI Assistant UI
function initAIAssistant() {
    updateAPIKeyStatus();
    setupAIEventListeners();
}

// Convert dataset to compact, comma-separated representation for the model context
function convertLeadsToCSV(leads) {
    const headers = ['Opportunity', 'Company', 'Salesperson', 'Expected Revenue', 'Stage', 'Won/Lost', 'RFQ Date', 'Closed Date', 'Contact Name', 'Email', 'Phone'];
    let csv = headers.join(',') + '\n';
    
    leads.forEach(lead => {
        const phone = lead['Phone'] || lead['Mobile'] || lead['Contact No'] || lead['Contact no'] || 'N/A';
        const closedDateVal = lead['Closed Date'] || lead['Date Closed'] || 'N/A';
        const row = [
            (lead['Opportunity'] || 'N/A').replace(/,/g, ' ').substring(0, 45).trim(),
            (lead['Company Name'] || 'N/A').replace(/,/g, ' ').substring(0, 35).trim(),
            (lead['Salesperson'] || 'Unassigned').replace(/,/g, ' ').trim(),
            lead['Expected Revenue'] || 0,
            (lead['Stage'] || 'Undefined').replace(/,/g, ' ').trim(),
            (lead['Won/Lost'] || 'Pending').replace(/,/g, ' ').trim(),
            lead['RFQ Date'] ? lead['RFQ Date'].substring(0, 10) : (lead['Created on'] ? lead['Created on'].substring(0, 10) : 'N/A'),
            closedDateVal.substring(0, 10),
            (lead['Contact Name'] || 'N/A').replace(/,/g, ' ').trim(),
            (lead['Email'] || 'N/A').replace(/,/g, ' ').trim(),
            phone.replace(/,/g, ' ').trim()
        ];
        csv += row.join(',') + '\n';
    });
    return csv;
}

// Update UI Indicators for API Key
function updateAPIKeyStatus() {
    const dot = document.getElementById('api-status-dot');
    const text = document.getElementById('api-status-text');
    const input = document.getElementById('input-api-key');
    
    if (geminiApiKey) {
        if (dot) { dot.className = 'status-dot online'; }
        if (text) { text.textContent = 'AI Assistant Connected'; }
        if (input) { input.value = geminiApiKey; }
    } else {
        if (dot) { dot.className = 'status-dot offline'; }
        if (text) { text.textContent = 'Gemini API Key Required'; }
        if (input) { input.value = ''; }
    }
}

// Update the right-side summary cards in the AI tab
function updateAICardStats() {
    const elLeads = document.getElementById('ai-stat-leads');
    const elRev = document.getElementById('ai-stat-revenue');
    const elWon = document.getElementById('ai-stat-won');
    
    if (!elLeads || !elRev || !elWon) return;
    
    const totalLeads = filteredLeads.length;
    const totalExpectedRevenue = filteredLeads.reduce((sum, lead) => sum + lead['Expected Revenue'], 0);
    const wonDealsCount = filteredLeads.filter(lead => lead['Won/Lost'] === 'Won').length;
    
    elLeads.textContent = totalLeads.toLocaleString();
    elRev.textContent = formatCurrency(totalExpectedRevenue);
    elWon.textContent = wonDealsCount.toLocaleString();
}

// Setup AI Tab specific event listeners
function setupAIEventListeners() {
    const trigger = document.getElementById('api-key-trigger');
    const modal = document.getElementById('api-modal');
    const btnClose = document.getElementById('btn-close-modal');
    const btnSave = document.getElementById('btn-save-key');
    const btnRemove = document.getElementById('btn-remove-key');
    const inputKey = document.getElementById('input-api-key');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const suggestions = document.querySelectorAll('.suggestion-btn');
    const btnClearChat = document.getElementById('btn-clear-chat');
    
    // Clear Chat
    if (btnClearChat) {
        btnClearChat.addEventListener('click', () => {
            aiChatHistory = [];
            const chatMessages = document.getElementById('chat-messages');
            if (chatMessages) {
                chatMessages.innerHTML = `
                    <div class="message system-message">
                        Chat history cleared. Welcome to the Elecbits AI Sales Assistant! Ask me anything about your sales data.
                    </div>
                `;
            }
        });
    }

    // Toggle Modal
    if (trigger && modal) {
        trigger.addEventListener('click', () => { showModal('api-modal'); });
    }
    if (btnClose && modal) {
        btnClose.addEventListener('click', () => { hideModal('api-modal'); });
    }
    // Close modal if clicking overlay
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) hideModal('api-modal');
        });
    }
    
    // Save Key
    if (btnSave && inputKey && modal) {
        btnSave.addEventListener('click', () => {
            const key = inputKey.value.trim();
            if (key) {
                geminiApiKey = key;
                localStorage.setItem('gemini_api_key', key);
                updateAPIKeyStatus();
                hideModal('api-modal');
                addSystemMessage("Gemini API key saved successfully. You can now chat!");
            } else {
                alert("Please enter a valid API Key.");
            }
        });
    }
    
    // Remove Key
    if (btnRemove && inputKey && modal) {
        btnRemove.addEventListener('click', () => {
            geminiApiKey = '';
            localStorage.removeItem('gemini_api_key');
            updateAPIKeyStatus();
            hideModal('api-modal');
            addSystemMessage("Gemini API key removed. You will need to enter a key to chat.");
        });
    }
    
    // Chat Form Submit
    if (chatForm && chatInput) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const message = chatInput.value.trim();
            if (!message) return;
            
            chatInput.value = '';
            handleUserMessage(message);
        });
    }
    
    // Suggested Questions
    suggestions.forEach(btn => {
        btn.addEventListener('click', () => {
            const query = btn.textContent;
            handleUserMessage(query);
        });
    });

    // AI Quick Actions
    const btnAiSummary = document.getElementById('btn-ai-summary');
    if (btnAiSummary) {
        btnAiSummary.addEventListener('click', () => {
            const userMsg = "📊 Generate Executive Pipeline Summary";
            const apiPrompt = "Please generate a structured, professional executive summary of the active sales pipeline. Focus on general health, top-performing salespeople, and critical risks based on the currently filtered leads dataset. Present it with headers and bullet points.";
            handleUserMessage(userMsg, apiPrompt);
        });
    }

    const btnAiProb = document.getElementById('btn-ai-prob');
    if (btnAiProb) {
        btnAiProb.addEventListener('click', () => {
            const userMsg = "🔮 Predict Top 5 Wins";
            const apiPrompt = "Analyze the active leads dataset and predict the top 5 leads that have the highest probability of closing as 'Won' this week. Explain the rationale/reasons for each of the 5 recommendations clearly, referencing their expected revenue, stage, salesperson, and timeline. Format it as a numbered list.";
            handleUserMessage(userMsg, apiPrompt);
        });
    }
}

// Append a system notification to the chat area
function addSystemMessage(text) {
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;
    
    const div = document.createElement('div');
    div.className = 'message system-message';
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Handle sending user query and loading AI reply
async function handleUserMessage(text, customPrompt = '') {
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;
    
    // 1. Add User Bubble to UI
    const userDiv = document.createElement('div');
    userDiv.className = 'message user-message';
    userDiv.textContent = text;
    chatMessages.appendChild(userDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Check key
    if (!geminiApiKey) {
        showModal('api-modal');
        addSystemMessage("Please enter your Gemini API Key first to chat.");
        return;
    }
    
    // 2. Add Typing Indicator to UI
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message ai-message typing-indicator';
    typingDiv.innerHTML = `
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
    `;
    chatMessages.appendChild(typingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    const promptToSend = customPrompt || text;
    // Push user message to local history
    aiChatHistory.push({
        role: "user",
        parts: [{ text: promptToSend }]
    });

    // Keep chat history clean and prevent memory blowup (limit to last 20 messages)
    if (aiChatHistory.length > 20) {
        aiChatHistory.shift();
    }
    
    try {
        // Convert active leads to token-efficient CSV format
        const csvData = convertLeadsToCSV(filteredLeads);
        
        const totalExpectedRevenue = filteredLeads.reduce((sum, lead) => sum + lead['Expected Revenue'], 0);
        const wonLeads = filteredLeads.filter(lead => lead['Won/Lost'] === 'Won');
        const wonRevenue = wonLeads.reduce((sum, lead) => sum + lead['Expected Revenue'], 0);
        const activeFilters = {
            salesperson: document.getElementById('filter-salesperson').value,
            stage: document.getElementById('filter-stage').value,
            industry: document.getElementById('filter-industry').value,
            type: document.getElementById('filter-type').value,
            status: document.getElementById('filter-status').value,
            rfqPeriod: document.getElementById('filter-rfq-period').value,
            rfqValue: document.getElementById('filter-rfq-value').value
        };

        const systemInstruction = `You are the Elecbits AI Sales Assistant, an expert data analyst for the Mahakal Eb-BB Sales Dashboard.
You have access to the active filtered leads dataset. Below is the dataset in CSV format:
=== START DATASET ===
${csvData}
=== END DATASET ===

Current Aggregated Stats in Dashboard:
- Total expected revenue: ${formatCurrency(totalExpectedRevenue)}
- Won deals: ${wonLeads.length}
- Won revenue: ${formatCurrency(wonRevenue)}
- Active filters applied: ${JSON.stringify(activeFilters)}
- Active Currency: ${activeCurrency} (Exchange rate: $1 = ₹${usdToInrRate})
- Today's date: June 13, 2026.

Rules:
1. Answer the user's questions based on the provided CSV dataset.
2. Be concise, clear, and professional. Do not make up any information.
3. If the user asks for a table or list, construct a clean markdown table or list.
4. Do not output raw JSON or internal CSV headers/code. Only give the final parsed answer.
5. Use the conversation history to understand follow-ups. If the user says something like "means week 24", check the previous user message to see what they are referring to.`;

        // Fetch Gemini 3.5 Flash API
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiApiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: aiChatHistory,
                systemInstruction: {
                    parts: [{
                        text: systemInstruction
                    }]
                },
                generationConfig: {
                    temperature: 0.15,
                    maxOutputTokens: 2048
                }
            })
        });
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || `API error ${response.status}`);
        }
        
        const data = await response.json();
        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I could not generate a response.";
        
        // Remove typing indicator
        if (chatMessages.contains(typingDiv)) {
            chatMessages.removeChild(typingDiv);
        }
        
        // Push AI message to local history
        aiChatHistory.push({
            role: "model",
            parts: [{ text: aiText }]
        });
        
        // 3. Add AI message bubble to UI
        const aiDiv = document.createElement('div');
        aiDiv.className = 'message ai-message';
        aiDiv.innerHTML = parseAITextToHTML(aiText);
        chatMessages.appendChild(aiDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
    } catch (error) {
        console.error("Gemini API Error:", error);
        if (chatMessages.contains(typingDiv)) {
            chatMessages.removeChild(typingDiv);
        }
        // Remove the failed user query from history so they can retry
        aiChatHistory.pop();
        addSystemMessage(`Error: ${error.message}. Please verify your API Key and connection.`);
    }
}

// Safe, lightweight markdown and table parser for rendering AI responses
function parseAITextToHTML(text) {
    // Escape HTML to prevent XSS (custom tags will be added safely)
    let html = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // Table parsing
    const lines = html.split('\n');
    let inTable = false;
    let tableHTML = '';
    const processedLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('|') && line.endsWith('|')) {
            if (!inTable) {
                inTable = true;
                tableHTML = '<div class="table-container" style="margin: 14px 0;"><table class="data-table" style="width:100%; font-size:12px; border-collapse:collapse;">';
            }
            
            const cells = line.split('|').map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
            
            if (line.includes('---')) {
                continue;
            }
            
            if (tableHTML.includes('<thead>')) {
                if (!tableHTML.includes('<tbody>')) {
                    tableHTML += '<tbody>';
                }
                tableHTML += '<tr>' + cells.map(c => `<td style="border: 1px solid var(--border-color); padding: 8px 12px;">${c}</td>`).join('') + '</tr>';
            } else {
                tableHTML += '<thead><tr style="background: var(--bg-input); font-weight:600;">' + cells.map(c => `<th style="border: 1px solid var(--border-color); padding: 8px 12px; text-align: left;">${c}</th>`).join('') + '</tr></thead>';
            }
        } else {
            if (inTable) {
                inTable = false;
                if (tableHTML.includes('<tbody>')) {
                    tableHTML += '</tbody>';
                }
                tableHTML += '</table></div>';
                processedLines.push(tableHTML);
                tableHTML = '';
            }
            processedLines.push(line);
        }
    }
    if (inTable) {
        if (tableHTML.includes('<tbody>')) {
            tableHTML += '</tbody>';
        }
        tableHTML += '</table></div>';
        processedLines.push(tableHTML);
    }

    html = processedLines.join('\n');

    // Bold (**text**)
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    
    // Inline code (`code`)
    html = html.replace(/`(.*?)`/g, "<code>$1</code>");
    
    // Code blocks (```lang ... ```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, "<pre style=\"background: var(--bg-input); padding: 12px; border-radius: 6px; overflow-x:auto;\"><code class=\"language-$1\">$2</code></pre>");
    
    // Unordered lists (- item)
    html = html.replace(/^\s*-\s+(.*)$/gm, "<li style=\"margin-left: 20px; list-style-type: disc;\">$1</li>");
    
    // Line breaks
    html = html.replace(/\n/g, "<br>");
    html = html.replace(/(<br>){2,}/g, "<br><br>");

    return html;
}
