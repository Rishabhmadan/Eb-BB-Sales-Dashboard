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
let activeCurrency = 'INR';
let usdToInrRate = 83.0; // 1 USD = 83 INR (fallback rate)

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

        const response = await fetch('leads_data.json');
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
        
        // Apply filters (which will calculate KPIs, draw charts and render table)
        applyFilters();

        // Register event listeners
        registerEventListeners();

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

// Apply current filter selections to the dataset
function applyFilters() {
    selectedRFQInterval = null;
    
    const elSalesperson = document.getElementById('filter-salesperson');
    const elStage = document.getElementById('filter-stage');
    const elIndustry = document.getElementById('filter-industry');
    const elType = document.getElementById('filter-type');
    const elStatus = document.getElementById('filter-status');
    const elRFQPeriod = document.getElementById('filter-rfq-period');
    const searchEl = document.getElementById('global-search');
    
    const fSalesperson = elSalesperson ? elSalesperson.value : 'all';
    const fStage = elStage ? elStage.value : 'all';
    const fIndustry = elIndustry ? elIndustry.value : 'all';
    const fType = elType ? elType.value : 'all';
    const fStatus = elStatus ? elStatus.value : 'all';
    const fRFQPeriod = elRFQPeriod ? elRFQPeriod.value : 'all';
    const searchQuery = searchEl ? searchEl.value.toLowerCase().trim() : '';

    filteredLeads = allLeads.filter(lead => {
        if (fSalesperson !== 'all' && lead['Salesperson'] !== fSalesperson) return false;
        if (fStage !== 'all' && lead['Stage'] !== fStage) return false;
        if (fIndustry !== 'all' && lead['Industry Segment'] !== fIndustry) return false;
        if (fType !== 'all' && lead['Opportunity Type'] !== fType) return false;
        if (fStatus !== 'all') {
            if (fStatus === 'Won' && lead['Won/Lost'] !== 'Won') return false;
            if (fStatus === 'Pending' && lead['Won/Lost'] === 'Won') return false;
        }
        
        if (fRFQPeriod !== 'all') {
            const rfqDateStr = lead['RFQ Date'];
            if (!rfqDateStr) return false;
            
            const rfqDate = new Date(rfqDateStr);
            if (isNaN(rfqDate.getTime())) return false;

            const today = new Date();
            const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

            if (fRFQPeriod === 'daily') {
                if (rfqDate < todayStart) return false;
            } else if (fRFQPeriod === 'weekly') {
                const day = today.getDay();
                const diff = today.getDate() - day + (day === 0 ? -6 : 1);
                const thisWeekStart = new Date(today.getFullYear(), today.getMonth(), diff);
                thisWeekStart.setHours(0, 0, 0, 0);
                if (rfqDate < thisWeekStart) return false;
            } else if (fRFQPeriod === 'monthly') {
                const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
                if (rfqDate < thisMonthStart) return false;
            } else if (fRFQPeriod === 'quarterly') {
                const currentQuarterMonth = Math.floor(today.getMonth() / 3) * 3;
                const thisQuarterStart = new Date(today.getFullYear(), currentQuarterMonth, 1);
                if (rfqDate < thisQuarterStart) return false;
            } else if (fRFQPeriod === 'annually') {
                const thisYearStart = new Date(today.getFullYear(), 0, 1);
                if (rfqDate < thisYearStart) return false;
            }
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
        
        filteredLeads.forEach(lead => {
            const st = lead['State'] || 'Unknown';
            const cnt = lead['Country'] || 'Unknown';
            stateData[st] = (stateData[st] || 0) + lead['Expected Revenue'];
            countryData[cnt] = (countryData[cnt] || 0) + lead['Expected Revenue'];
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
    }

    if (activeTab === 'rfq') {
        updateRFQCharts();
    }
}

// Render dynamic tables based on currently active tab
function renderTables() {
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
                    <td class="num-col">${data.count.toLocaleString()}</td>
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
                    <td class="num-col">${data.leads.toLocaleString()}</td>
                    <td class="num-col">${data.won.toLocaleString()}</td>
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
                    <td class="num-col">${data.count.toLocaleString()}</td>
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
                <td><span style="font-weight:600; color:var(--text-primary);" title="${lead['Opportunity']}">${shortOppName}</span></td>
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

// Set up UI interactions, search, sorting and sidebar clicks
function registerEventListeners() {
    // 1. Sidebar tab switching
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Toggle active state
            menuItems.forEach(mi => mi.classList.remove('active'));
            item.classList.add('active');
            
            // Show corresponding tab view
            const tabName = item.getAttribute('data-tab');
            activeTab = tabName;
            
            // Update page headers
            const pageTitles = {
                overview: 'Executive Overview',
                pipeline: 'Pipeline Funnel Analysis',
                team: 'Sales Team Performance',
                geo: 'Geographic Distribution',
                rfq: 'RFQ Tracking',
                explorer: 'Leads Data Explorer'
            };
            document.getElementById('page-title').textContent = pageTitles[tabName];
            
            // Hide all tabs, show active one
            document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
            document.getElementById(`tab-${tabName}`).classList.add('active');
            
            // Redraw/initialize charts & tables for the active tab
            updateCharts();
            renderTables();
        });
    });

    // 2. Dropdown Filter Selection triggers recalculations
    const dropdowns = ['filter-salesperson', 'filter-stage', 'filter-industry', 'filter-type', 'filter-status', 'filter-rfq-period'];
    dropdowns.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => {
                applyFilters();
            });
        }
    });

    // 3. Reset filters button
    const resetBtn = document.getElementById('reset-filters-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            dropdowns.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = 'all';
            });
            const globalSearchEl = document.getElementById('global-search');
            if (globalSearchEl) globalSearchEl.value = '';
            applyFilters();
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

function updateRFQKPIs() {
    const rfqLeads = filteredLeads.filter(lead => lead['RFQ Date'] !== null);
    const rfqCount = rfqLeads.length;
    const rfqRevenue = rfqLeads.reduce((sum, lead) => sum + lead['Expected Revenue'], 0);
    const rfqAvg = rfqCount > 0 ? (rfqRevenue / rfqCount) : 0;
    const rfqActive = rfqLeads.filter(lead => !['Won', 'Dropped'].includes(lead['Stage'])).length;

    document.getElementById('kpi-rfq-count').textContent = rfqCount.toLocaleString();
    document.getElementById('kpi-rfq-revenue').textContent = formatCurrency(rfqRevenue);
    document.getElementById('kpi-rfq-avg').textContent = formatCurrency(rfqAvg);
    document.getElementById('kpi-rfq-active').textContent = rfqActive.toLocaleString();
}

function updateRFQCharts() {
    const currDetails = getCurrencyDetails();
    const isDark = document.body.classList.contains('dark-theme');
    const textColor = isDark ? '#9ca3af' : '#64748b';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    
    const rfqLeads = filteredLeads.filter(lead => lead['RFQ Date'] !== null);

    // 1. RFQ Trend Chart
    const rfqTrendData = {};
    if (rfqLeads.length > 0) {
        // Find min and max dates
        let minDate = new Date(rfqLeads[0]['RFQ Date']);
        let maxDate = new Date(rfqLeads[0]['RFQ Date']);
        rfqLeads.forEach(lead => {
            const d = new Date(lead['RFQ Date']);
            if (d < minDate) minDate = d;
            if (d > maxDate) maxDate = d;
        });

        // Initialize helper to get week key
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
            const dateStr = lead['RFQ Date'];
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
        if (filterVal) filterVal.textContent = selectedRFQInterval;
    } else {
        if (filterIndicator) filterIndicator.style.display = 'none';
    }

    let rfqLeads = filteredLeads.filter(lead => lead['RFQ Date'] !== null);
    
    // Apply chart click interval filter if set
    if (selectedRFQInterval) {
        rfqLeads = rfqLeads.filter(lead => {
            return getLabelForRFQDate(lead['RFQ Date'], rfqGranularity) === selectedRFQInterval;
        });
    }

    rfqLeads.sort((a, b) => new Date(b['RFQ Date']) - new Date(a['RFQ Date']));

    if (rfqLeads.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--text-muted); padding:30px;">No RFQs match filter settings.</td></tr>`;
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

        tr.innerHTML = `
            <td><strong>${shortName}</strong></td>
            <td>${lead['Company Name'] || 'N/A'}</td>
            <td>${lead['Salesperson']}</td>
            <td class="num-col">${cleanDate}</td>
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
            selectedRFQInterval = null; // Clear active chart filter on granularity switch
            updateRFQCharts();
            renderRFQTable();
        });
    });

    const clearBtn = document.getElementById('btn-clear-rfq-filter');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            selectedRFQInterval = null;
            renderRFQTable();
        });
    }
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
    } else if (granularity === 'annual') {
        return `${date.getFullYear()}`;
    }
    return '';
}
