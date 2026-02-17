import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import './Portfolio.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

/* ── Types ── */
interface Holding {
  symbol: string;
  quantity: number;
  avg_cost_usd: number;
  current_price_usd: number;
  market_value_usd: number;
  unrealized_pnl_usd: number;
  unrealized_pnl_pct: number;
}

interface BankRates {
  bid: number; ask: number; mid: number;
  spread: number; spread_pct: number; source: string;
}

interface PeriodicReturn {
  period: string; pnl_pct: number;
  pnl_usd: number; pnl_try: number;
}

interface PortfolioData {
  username: string;
  cash_usd: number;
  cash_try: number;
  interest_balance_usd: number;
  interest_balance_try: number;
  holdings_value_usd: number;
  holdings_value_try: number;
  total_value_usd: number;
  total_value_try: number;
  total_deposited_usd: number;
  total_deposited_try: number;
  usd_try_rate: number;
  nominal_pnl_usd: number;
  nominal_pnl_try: number;
  nominal_pnl_pct: number;
  inflation_factor: number;
  inflation_adjusted_pnl_usd: number;
  expected_cpi: { annual_rate: number; source: string } | null;
  inflation_method: string;
  holdings: Holding[];
  bank_rates?: BankRates;
  periodic_returns?: {
    quarterly_avg?: PeriodicReturn;
    annualized?: PeriodicReturn;
    since_inception?: { days: number; pnl_usd: number; pnl_try: number; pnl_pct: number; start_date: string };
  };
}

interface SearchResult {
  symbol: string; name: string; group: string;
}

interface Transaction {
  id: number;
  type: string;
  symbol: string | null;
  quantity: number | null;
  amount_try: number | null;
  amount_usd: number | null;
  usd_try_rate: number | null;
  interest_rate: number | null;
  interest_days: number | null;
  interest_earned_usd: number | null;
  interest_earned_try: number | null;
  note: string | null;
  transaction_date: string | null;
  created_at: string;
}

/* ── Tabs & View ── */
type Tab = 'overview' | 'deposit' | 'trade' | 'interest' | 'history';
type ViewMode = 'usd' | 'try' | 'real';

const TRADE_CATEGORIES = [
  { key: 'crypto', label: 'Crypto', icon: '₿' },
  { key: 'commodity', label: 'Commodities', icon: '🪙' },
  { key: 'forex', label: 'Forex', icon: '💱' },
  { key: 'bist100', label: 'BIST 100', icon: '🇹🇷' },
  { key: 'sp500', label: 'S&P 500', icon: '📊' },
];

const Portfolio: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [viewMode, setViewMode] = useState<ViewMode>('usd');
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  /* ── Form state ── */
  const [depositAmount, setDepositAmount] = useState('');
  const [depositCurrency, setDepositCurrency] = useState<'TRY' | 'USD'>('TRY');
  const [depositDate, setDepositDate] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawCurrency, setWithdrawCurrency] = useState<'USD' | 'TRY'>('USD');
  const [withdrawDate, setWithdrawDate] = useState('');
  const [exchangeAmount, setExchangeAmount] = useState('');
  const [exchangeRate, setExchangeRate] = useState('');
  const [exchangeDir, setExchangeDir] = useState<'buy_usd' | 'sell_usd'>('buy_usd');
  const [exchangeDate, setExchangeDate] = useState('');

  /* Trade state */
  const [tradeCategory, setTradeCategory] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [buySymbol, setBuySymbol] = useState('');
  const [buyMode, setBuyMode] = useState<'quantity' | 'amount'>('quantity');
  const [buyQuantity, setBuyQuantity] = useState('');
  const [buyAmount, setBuyAmount] = useState('');
  const [buyDate, setBuyDate] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [sellSymbol, setSellSymbol] = useState('');
  const [sellSearchQuery, setSellSearchQuery] = useState('');
  const [sellSearchResults, setSellSearchResults] = useState<SearchResult[]>([]);
  const [sellMode, setSellMode] = useState<'quantity' | 'amount'>('quantity');
  const [sellQuantity, setSellQuantity] = useState('');
  const [sellAmount, setSellAmount] = useState('');
  const [sellDate, setSellDate] = useState('');
  const [sellPrice, setSellPrice] = useState('');

  /* Interest state */
  const [interestCurrency, setInterestCurrency] = useState<'USD' | 'TRY'>('USD');
  const [interestAmount, setInterestAmount] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [interestStartDate, setInterestStartDate] = useState('');
  const [interestEndDate, setInterestEndDate] = useState('');
  const [interestPaymentInterval, setInterestPaymentInterval] = useState<'daily' | 'weekly' | 'monthly' | 'end'>('end');

  /* Delete confirmation */
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const token = localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}` };

  const loadPortfolio = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/portfolio`, { headers });
      setPortfolio(res.data);
      setError(null);
    } catch (e: any) {
      console.error('Failed to load portfolio:', e);
      setError(e.response?.data?.detail || e.message || 'Failed to load portfolio data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTransactions = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/portfolio/transactions`, { headers });
      setTransactions(res.data);
    } catch (e: any) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadPortfolio();
    loadTransactions();
  }, []);

  /* Search assets - Buy */
  useEffect(() => {
    if (searchQuery.length < 1) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await axios.get(`${API_URL}/api/markets/search`, { params: { q: searchQuery } });
        let results: SearchResult[] = res.data;
        if (tradeCategory) {
          results = results.filter(r => r.group === tradeCategory || r.group === 'unknown');
        }
        setSearchResults(results);
      } catch { setSearchResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, tradeCategory]);

  /* Search assets - Sell */
  useEffect(() => {
    if (sellSearchQuery.length < 1) { setSellSearchResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await axios.get(`${API_URL}/api/markets/search`, { params: { q: sellSearchQuery } });
        let results: SearchResult[] = res.data;
        if (tradeCategory) {
          results = results.filter(r => r.group === tradeCategory || r.group === 'unknown');
        }
        setSellSearchResults(results);
      } catch { setSellSearchResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [sellSearchQuery, tradeCategory]);

  const flashMsg = (msg: string, isError = false) => {
    if (isError) { setError(msg); setSuccess(null); }
    else { setSuccess(msg); setError(null); }
    setTimeout(() => { setError(null); setSuccess(null); }, 4000);
  };

  /* ── Actions ── */
  const doDeposit = async () => {
    if (!depositAmount || Number(depositAmount) <= 0) return;
    setActionLoading(true);
    try {
      const body: any = depositCurrency === 'USD'
        ? { amount_usd: Number(depositAmount), currency: 'USD' }
        : { amount_try: Number(depositAmount), currency: 'TRY' };
      if (depositDate) body.transaction_date = depositDate;
      const res = await axios.post(`${API_URL}/api/portfolio/deposit`, body, { headers });
      flashMsg(`Deposited ${depositCurrency === 'USD' ? '$' : '₺'}${Number(depositAmount).toLocaleString()} ${depositCurrency}`);
      setDepositAmount(''); setDepositDate('');
      loadPortfolio(); loadTransactions();
    } catch (e: any) {
      flashMsg(e.response?.data?.detail || 'Deposit failed', true);
    } finally { setActionLoading(false); }
  };

  const doWithdraw = async () => {
    if (!withdrawAmount || Number(withdrawAmount) <= 0) return;
    setActionLoading(true);
    try {
      const body: any = withdrawCurrency === 'TRY'
        ? { amount_try: Number(withdrawAmount), currency: 'TRY' }
        : { amount_usd: Number(withdrawAmount), currency: 'USD' };
      if (withdrawDate) body.transaction_date = withdrawDate;
      await axios.post(`${API_URL}/api/portfolio/withdraw`, body, { headers });
      flashMsg(`Withdrew ${withdrawCurrency === 'TRY' ? '₺' : '$'}${Number(withdrawAmount).toLocaleString()} ${withdrawCurrency}`);
      setWithdrawAmount(''); setWithdrawDate('');
      loadPortfolio(); loadTransactions();
    } catch (e: any) {
      flashMsg(e.response?.data?.detail || 'Withdraw failed', true);
    } finally { setActionLoading(false); }
  };

  const doExchange = async () => {
    if (!exchangeAmount || Number(exchangeAmount) <= 0 || !exchangeRate || Number(exchangeRate) <= 0) return;
    setActionLoading(true);
    try {
      const payload: any = {
        amount_try: Number(exchangeAmount),
        rate: Number(exchangeRate),
        direction: exchangeDir,
      };
      if (exchangeDate) {
        payload.transaction_date = exchangeDate;
      }
      const res = await axios.post(`${API_URL}/api/portfolio/exchange`, payload, { headers });
      const d = res.data;
      const calcUsd = (Number(exchangeAmount) / Number(exchangeRate)).toFixed(4);
      if (exchangeDir === 'buy_usd') {
        flashMsg(`Bought $${calcUsd} for ₺${Number(exchangeAmount).toLocaleString()} at ${Number(exchangeRate).toFixed(4)}`);
      } else {
        flashMsg(`Sold $${calcUsd} for ₺${Number(exchangeAmount).toLocaleString()} at ${Number(exchangeRate).toFixed(4)}`);
      }
      setExchangeAmount(''); setExchangeRate(''); setExchangeDate('');
      loadPortfolio(); loadTransactions();
    } catch (e: any) {
      flashMsg(e.response?.data?.detail || 'Exchange failed', true);
    } finally { setActionLoading(false); }
  };

  const doBuy = async () => {
    if (!buySymbol || !buyPrice || Number(buyPrice) <= 0) return;
    if (buyMode === 'quantity' && (!buyQuantity || Number(buyQuantity) <= 0)) return;
    if (buyMode === 'amount' && (!buyAmount || Number(buyAmount) <= 0)) return;
    setActionLoading(true);
    try {
      const body: any = { symbol: buySymbol.toUpperCase(), custom_price: Number(buyPrice) };
      if (buyMode === 'quantity') body.quantity = Number(buyQuantity);
      else body.amount_usd = Number(buyAmount);
      if (buyDate) body.transaction_date = buyDate;
      const res = await axios.post(`${API_URL}/api/portfolio/buy`, body, { headers });
      flashMsg(`Bought ${buyMode === 'quantity' ? buyQuantity : res.data.quantity} ${buySymbol.toUpperCase()} at $${(res.data.price_usd ?? 0).toFixed(4)}`);
      setBuySymbol(''); setBuyQuantity(''); setBuyAmount(''); setBuyDate(''); setBuyPrice(''); setSearchQuery(''); setSearchResults([]);
      loadPortfolio(); loadTransactions();
    } catch (e: any) {
      flashMsg(e.response?.data?.detail || 'Buy failed', true);
    } finally { setActionLoading(false); }
  };

  const doSell = async () => {
    if (!sellSymbol || !sellPrice || Number(sellPrice) <= 0) return;
    if (sellMode === 'quantity' && (!sellQuantity || Number(sellQuantity) <= 0)) return;
    if (sellMode === 'amount' && (!sellAmount || Number(sellAmount) <= 0)) return;
    setActionLoading(true);
    try {
      const body: any = { symbol: sellSymbol.toUpperCase(), custom_price: Number(sellPrice) };
      if (sellMode === 'quantity') body.quantity = Number(sellQuantity);
      else body.amount_usd = Number(sellAmount);
      if (sellDate) body.transaction_date = sellDate;
      const res = await axios.post(`${API_URL}/api/portfolio/sell`, body, { headers });
      flashMsg(`Sold ${sellMode === 'quantity' ? sellQuantity : res.data.quantity} ${sellSymbol.toUpperCase()} at $${(res.data.price_usd ?? 0).toFixed(4)} — P&L: $${(res.data.realized_pnl_usd ?? 0).toFixed(2)}`);
      setSellSymbol(''); setSellQuantity(''); setSellAmount(''); setSellDate(''); setSellPrice(''); setSellSearchQuery(''); setSellSearchResults([]);
      loadPortfolio(); loadTransactions();
    } catch (e: any) {
      flashMsg(e.response?.data?.detail || 'Sell failed', true);
    } finally { setActionLoading(false); }
  };

  const doInterestIn = async () => {
    if (!interestAmount || !interestRate || !interestStartDate || !interestEndDate) return;
    setActionLoading(true);
    try {
      const res = await axios.post(`${API_URL}/api/portfolio/interest/in`, {
        amount: Number(interestAmount),
        currency: interestCurrency,
        annual_rate: Number(interestRate),
        start_date: interestStartDate,
        end_date: interestEndDate,
        payment_interval: interestPaymentInterval,
      }, { headers });
      const sym = interestCurrency === 'USD' ? '$' : '₺';
      const earned = interestCurrency === 'USD' ? res.data.interest_earned_usd : res.data.interest_earned_try;
      flashMsg(`Interest deposit: ${sym}${Number(interestAmount).toFixed(2)} at ${interestRate}% from ${interestStartDate} to ${interestEndDate} (${res.data.days} days, ${interestPaymentInterval} payments) → earns ${sym}${(earned ?? 0).toFixed(4)}`);
      setInterestAmount(''); setInterestRate(''); setInterestStartDate(''); setInterestEndDate(''); setInterestPaymentInterval('end');
      loadPortfolio(); loadTransactions();
    } catch (e: any) {
      flashMsg(e.response?.data?.detail || 'Interest deposit failed', true);
    } finally { setActionLoading(false); }
  };

  const doInterestOut = async (currency: 'USD' | 'TRY') => {
    if (!portfolio) return;
    const bal = currency === 'USD' ? portfolio.interest_balance_usd : portfolio.interest_balance_try;
    if (bal <= 0) return;
    setActionLoading(true);
    try {
      const lastInterest = transactions.find(
        (t: Transaction) => t.type === 'interest_in' &&
          (currency === 'USD' ? (t.interest_earned_usd != null && t.interest_earned_usd > 0) :
                                (t.interest_earned_try != null && t.interest_earned_try! > 0))
      );
      const earned = currency === 'USD'
        ? (lastInterest?.interest_earned_usd || 0)
        : (lastInterest?.interest_earned_try || 0);
      await axios.post(`${API_URL}/api/portfolio/interest/out`, {
        amount: bal, earned, currency,
      }, { headers });
      const sym = currency === 'USD' ? '$' : '₺';
      flashMsg(`Withdrew interest deposit: ${sym}${(bal ?? 0).toFixed(2)} + ${sym}${(earned ?? 0).toFixed(4)} earned`);
      loadPortfolio(); loadTransactions();
    } catch (e: any) {
      flashMsg(e.response?.data?.detail || 'Interest withdrawal failed', true);
    } finally { setActionLoading(false); }
  };

  const doDeleteTransaction = async (txId: number) => {
    setActionLoading(true);
    try {
      await axios.delete(`${API_URL}/api/portfolio/transactions/${txId}`, { headers });
      flashMsg('Transaction deleted successfully');
      setDeleteConfirmId(null);
      loadPortfolio();
      loadTransactions();
    } catch (e: any) {
      flashMsg(e.response?.data?.detail || 'Failed to delete transaction', true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleLogout = () => { logout(); navigate('/signin'); };

  /* ── Formatters ── */
  const fmtUsd = (v: number) => `$${(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtTry = (v: number) => `₺${(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtVal = (usd: number, tryV: number) => {
    if (viewMode === 'try') return fmtTry(tryV ?? 0);
    if (viewMode === 'real' && portfolio)
      return fmtUsd((usd ?? 0) * (portfolio.inflation_factor ?? 1));
    return fmtUsd(usd ?? 0);
  };
  const pnlClass = (v: number) => (v ?? 0) >= 0 ? 'positive' : 'negative';
  const pnlSign = (v: number) => (v ?? 0) >= 0 ? '+' : '';

  const txTypeLabel: Record<string, string> = {
    deposit: 'Deposit', withdraw: 'Withdraw',
    buy: 'Buy', sell: 'Sell',
    interest_in: 'Interest In', interest_out: 'Interest Out',
    exchange: 'Exchange',
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'deposit', label: 'Deposit / Withdraw' },
    { id: 'trade', label: 'Trade' },
    { id: 'interest', label: 'Interest' },
    { id: 'history', label: 'History' },
  ];

  const bankRates = portfolio?.bank_rates;
  const periodicReturns = portfolio?.periodic_returns;

  return (
    <div className="pf">
      {/* ── Top bar ── */}
      <header className="pf-topbar">
        <div className="pf-topbar-inner">
          <div className="pf-brand">
            <span className="pf-logo">Q</span>
            <span className="pf-brand-text">Portfolio</span>
          </div>
          <nav className="pf-nav">
            <button className="pf-nav-btn" onClick={() => navigate('/dashboard')}>Dashboard</button>
            <button className="pf-nav-btn" onClick={() => navigate('/market')}>Markets</button>
            <button className="pf-nav-btn active">Portfolio</button>
            <button className="pf-nav-btn" onClick={() => navigate('/profile')}>Profile</button>
          </nav>
          <div className="pf-topbar-right">
            <span className="pf-user-chip">{user?.username}</span>
            <button className="pf-logout-btn" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </header>

      <div className="pf-body">
        {/* ── Tab bar ── */}
        <div className="pf-tabs">
          {TABS.map(t => (
            <button key={t.id} className={`pf-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Messages ── */}
        {error && <div className="pf-msg pf-msg--error">{error}</div>}
        {success && <div className="pf-msg pf-msg--success">{success}</div>}

        {loading ? (
          <div className="pf-loading">Loading portfolio...</div>
        ) : !portfolio ? (
          <div className="pf-loading">No portfolio data available. Please check your connection and try refreshing.</div>
        ) : (
          <>
            {/* ═══ OVERVIEW TAB ═══ */}
            {tab === 'overview' && portfolio && (
              <div className="pf-overview">
                {/* View mode toggle */}
                <div className="pf-view-toggle">
                  {(['usd', 'try', 'real'] as ViewMode[]).map(m => (
                    <button key={m} className={`pf-view-btn ${viewMode === m ? 'active' : ''}`} onClick={() => setViewMode(m)}>
                      {m === 'usd' ? '$ USD' : m === 'try' ? '₺ TRY' : '📊 Real'}
                    </button>
                  ))}
                </div>

                {/* Balance cards */}
                <div className="pf-balance-grid">
                  <div className="pf-balance-card pf-balance-card--main">
                    <span className="pf-bal-label">Total Value</span>
                    <span className="pf-bal-usd">{fmtVal(portfolio.total_value_usd, portfolio.total_value_try)}</span>
                    {viewMode === 'usd' && <span className="pf-bal-try">{fmtTry(portfolio.total_value_try)}</span>}
                  </div>
                  <div className="pf-balance-card">
                    <span className="pf-bal-label">Cash (USD)</span>
                    <span className="pf-bal-usd">{fmtUsd(portfolio.cash_usd)}</span>
                  </div>
                  <div className="pf-balance-card">
                    <span className="pf-bal-label">Cash (TRY)</span>
                    <span className="pf-bal-usd">{fmtTry(portfolio.cash_try)}</span>
                  </div>
                  <div className="pf-balance-card">
                    <span className="pf-bal-label">Holdings</span>
                    <span className="pf-bal-usd">{fmtVal(portfolio.holdings_value_usd, portfolio.holdings_value_try)}</span>
                  </div>
                  <div className="pf-balance-card">
                    <span className="pf-bal-label">Interest (USD)</span>
                    <span className="pf-bal-usd">{fmtUsd(portfolio.interest_balance_usd)}</span>
                  </div>
                  <div className="pf-balance-card">
                    <span className="pf-bal-label">Interest (TRY)</span>
                    <span className="pf-bal-usd">{fmtTry(portfolio.interest_balance_try)}</span>
                  </div>
                </div>

                {/* P&L section */}
                <div className="pf-pnl-section">
                  <h3>Profit & Loss</h3>
                  <div className="pf-pnl-grid">
                    <div className="pf-pnl-card">
                      <span className="pf-pnl-label">Total Deposited</span>
                      <span className="pf-pnl-value">{fmtVal(portfolio.total_deposited_usd, portfolio.total_deposited_try)}</span>
                    </div>
                    <div className="pf-pnl-card">
                      <span className="pf-pnl-label">Nominal P&L (USD)</span>
                      <span className={`pf-pnl-value ${pnlClass(portfolio.nominal_pnl_usd)}`}>
                        {pnlSign(portfolio.nominal_pnl_usd)}{fmtUsd(portfolio.nominal_pnl_usd)}
                      </span>
                      <span className={`pf-pnl-sub ${pnlClass(portfolio.nominal_pnl_pct)}`}>
                        {pnlSign(portfolio.nominal_pnl_pct)}{(portfolio.nominal_pnl_pct ?? 0).toFixed(2)}%
                      </span>
                    </div>
                    {portfolio.nominal_pnl_try !== undefined && (
                      <div className="pf-pnl-card">
                        <span className="pf-pnl-label">Nominal P&L (TRY)</span>
                        <span className={`pf-pnl-value ${pnlClass(portfolio.nominal_pnl_try)}`}>
                          {pnlSign(portfolio.nominal_pnl_try)}{fmtTry(portfolio.nominal_pnl_try)}
                        </span>
                      </div>
                    )}
                    <div className="pf-pnl-card">
                      <span className="pf-pnl-label">Inflation-Adjusted P&L</span>
                      <span className={`pf-pnl-value ${pnlClass(portfolio.inflation_adjusted_pnl_usd)}`}>
                        {pnlSign(portfolio.inflation_adjusted_pnl_usd)}{fmtUsd(portfolio.inflation_adjusted_pnl_usd)}
                      </span>
                      <span className="pf-pnl-sub">Factor: {(portfolio.inflation_factor ?? 1).toFixed(6)}</span>
                    </div>
                    <div className="pf-pnl-card">
                      <span className="pf-pnl-label">USD/TRY Rate</span>
                      <span className="pf-pnl-value">{(portfolio.usd_try_rate ?? 0).toFixed(4)}</span>
                      {portfolio.expected_cpi && (
                        <span className="pf-pnl-sub">Expected CPI: {portfolio.expected_cpi.annual_rate}% ({portfolio.expected_cpi.source})</span>
                      )}
                    </div>
                  </div>

                  {/* Periodic Returns */}
                  {periodicReturns && periodicReturns.since_inception && (
                    <div className="pf-returns-section">
                      <h4>Returns</h4>
                      <div className="pf-pnl-grid">
                        <div className="pf-pnl-card">
                          <span className="pf-pnl-label">Since Inception ({periodicReturns.since_inception.days} days)</span>
                          <span className={`pf-pnl-value ${pnlClass(periodicReturns.since_inception.pnl_pct)}`}>
                            {pnlSign(periodicReturns.since_inception.pnl_pct)}{(periodicReturns.since_inception.pnl_pct ?? 0).toFixed(2)}%
                          </span>
                          <span className="pf-pnl-sub">
                            {pnlSign(periodicReturns.since_inception.pnl_usd)}{fmtUsd(periodicReturns.since_inception.pnl_usd)}
                            {' / '}
                            {pnlSign(periodicReturns.since_inception.pnl_try)}{fmtTry(periodicReturns.since_inception.pnl_try)}
                          </span>
                        </div>
                        {periodicReturns.quarterly_avg && (
                          <div className="pf-pnl-card">
                            <span className="pf-pnl-label">Quarterly Avg Return</span>
                            <span className={`pf-pnl-value ${pnlClass(periodicReturns.quarterly_avg.pnl_pct)}`}>
                              {pnlSign(periodicReturns.quarterly_avg.pnl_pct)}{(periodicReturns.quarterly_avg.pnl_pct ?? 0).toFixed(2)}%
                            </span>
                          </div>
                        )}
                        {periodicReturns.annualized && (
                          <div className="pf-pnl-card">
                            <span className="pf-pnl-label">Annualized Return</span>
                            <span className={`pf-pnl-value ${pnlClass(periodicReturns.annualized.pnl_pct)}`}>
                              {pnlSign(periodicReturns.annualized.pnl_pct)}{(periodicReturns.annualized.pnl_pct ?? 0).toFixed(2)}%
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Bank Rates */}
                  {bankRates && (
                    <div className="pf-returns-section">
                      <h4>Bank FX Rates (TCMB)</h4>
                      <div className="pf-pnl-grid">
                        <div className="pf-pnl-card">
                          <span className="pf-pnl-label">Bid (Sell USD)</span>
                          <span className="pf-pnl-value">{(bankRates.bid ?? 0).toFixed(4)}</span>
                        </div>
                        <div className="pf-pnl-card">
                          <span className="pf-pnl-label">Ask (Buy USD)</span>
                          <span className="pf-pnl-value">{(bankRates.ask ?? 0).toFixed(4)}</span>
                        </div>
                        <div className="pf-pnl-card">
                          <span className="pf-pnl-label">Spread</span>
                          <span className="pf-pnl-value">{(bankRates.spread ?? 0).toFixed(4)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Methodology */}
                  <details className="pf-method">
                    <summary>Inflation Methodology</summary>
                    <p>{portfolio.inflation_method}</p>
                    <p className="pf-method-formula">
                      <strong>Formula:</strong> Each quarter's erosion = (1 + q_inflation)^(days_elapsed / total_quarter_days).
                      For partial quarters at deposit or current date, the exponent is fractional.
                      Total factor is the product across all quarters.
                    </p>
                  </details>
                </div>

                {/* Holdings table */}
                {portfolio.holdings.length > 0 && (
                  <div className="pf-holdings-section">
                    <h3>Holdings</h3>
                    <div className="pf-table-wrap">
                      <table className="pf-table">
                        <thead>
                          <tr>
                            <th>Symbol</th>
                            <th>Qty</th>
                            <th>Avg Cost</th>
                            <th>Price</th>
                            <th>Value</th>
                            <th>P&L</th>
                            <th>P&L %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {portfolio.holdings.map(h => (
                            <tr key={h.symbol}>
                              <td className="pf-td-sym">{h.symbol}</td>
                              <td>{(h.quantity ?? 0).toFixed(4)}</td>
                              <td>{fmtUsd(h.avg_cost_usd)}</td>
                              <td>{fmtUsd(h.current_price_usd)}</td>
                              <td>{fmtVal(h.market_value_usd, h.market_value_usd * (portfolio.usd_try_rate ?? 0))}</td>
                              <td className={pnlClass(h.unrealized_pnl_usd)}>
                                {pnlSign(h.unrealized_pnl_usd)}{fmtUsd(h.unrealized_pnl_usd)}
                              </td>
                              <td className={pnlClass(h.unrealized_pnl_pct)}>
                                {pnlSign(h.unrealized_pnl_pct)}{(h.unrealized_pnl_pct ?? 0).toFixed(2)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ═══ DEPOSIT / WITHDRAW TAB ═══ */}
            {tab === 'deposit' && (
              <div className="pf-forms">
                {/* Deposit section */}
                <div className="pf-form-card">
                  <h3>Deposit</h3>
                  <div className="pf-currency-toggle">
                    <button className={depositCurrency === 'TRY' ? 'active' : ''} onClick={() => setDepositCurrency('TRY')}>₺ TRY</button>
                    <button className={depositCurrency === 'USD' ? 'active' : ''} onClick={() => setDepositCurrency('USD')}>$ USD</button>
                  </div>
                  <p className="pf-form-hint">
                    {depositCurrency === 'TRY'
                      ? 'Enter amount in Turkish Lira. Will be held as TRY in your portfolio.'
                      : 'Enter amount in US Dollars.'}
                  </p>
                  <div className="pf-input-row">
                    <div className="pf-labeled-input">
                      <label>Miktar ({depositCurrency})</label>
                      <input type="number" placeholder="0.00" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} />
                    </div>
                    <div className="pf-labeled-input">
                      <label>Tarih</label>
                      <input type="date" value={depositDate} onChange={e => setDepositDate(e.target.value)} />
                    </div>
                    <button onClick={doDeposit} disabled={actionLoading}>Deposit {depositCurrency}</button>
                  </div>
                </div>

                {/* Withdraw section */}
                <div className="pf-form-card">
                  <h3>Withdraw</h3>
                  <div className="pf-currency-toggle">
                    <button className={withdrawCurrency === 'USD' ? 'active' : ''} onClick={() => setWithdrawCurrency('USD')}>$ USD</button>
                    <button className={withdrawCurrency === 'TRY' ? 'active' : ''} onClick={() => setWithdrawCurrency('TRY')}>₺ TRY</button>
                  </div>
                  <p className="pf-form-hint">
                    Available: {withdrawCurrency === 'USD'
                      ? (portfolio ? fmtUsd(portfolio.cash_usd) : '$0.00')
                      : (portfolio ? fmtTry(portfolio.cash_try) : '₺0.00')}
                  </p>
                  <div className="pf-input-row">
                    <div className="pf-labeled-input">
                      <label>Miktar ({withdrawCurrency})</label>
                      <input type="number" placeholder="0.00" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} />
                    </div>
                    <div className="pf-labeled-input">
                      <label>Tarih</label>
                      <input type="date" value={withdrawDate} onChange={e => setWithdrawDate(e.target.value)} />
                    </div>
                    <button onClick={doWithdraw} disabled={actionLoading}>Withdraw {withdrawCurrency}</button>
                  </div>
                </div>

                {/* Exchange section */}
                <div className="pf-form-card pf-exchange-card">
                  <h3>💱 Currency Exchange</h3>
                  <div className="pf-currency-toggle">
                    <button className={exchangeDir === 'buy_usd' ? 'active' : ''} onClick={() => setExchangeDir('buy_usd')}>
                      Buy USD (₺→$)
                    </button>
                    <button className={exchangeDir === 'sell_usd' ? 'active' : ''} onClick={() => setExchangeDir('sell_usd')}>
                      Sell USD ($→₺)
                    </button>
                  </div>
                  <p className="pf-form-hint">
                    {exchangeDir === 'buy_usd'
                      ? `TRY available: ${portfolio ? fmtTry(portfolio.cash_try) : '₺0.00'} — Enter TRY amount and exchange rate.`
                      : `USD available: ${portfolio ? fmtUsd(portfolio.cash_usd) : '$0.00'} — Enter TRY amount and exchange rate.`}
                  </p>
                  <div className="pf-input-row">
                    <div className="pf-labeled-input">
                      <label>TRY Miktarı</label>
                      <input type="number"
                        placeholder="0.00"
                        value={exchangeAmount} onChange={e => setExchangeAmount(e.target.value)} />
                    </div>
                    <div className="pf-labeled-input">
                      <label>Kur (TRY/USD)</label>
                      <input type="number"
                        placeholder="0.0000"
                        value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} step="0.0001" />
                    </div>
                    <div className="pf-labeled-input">
                      <label>Tarih</label>
                      <input type="date"
                        value={exchangeDate} onChange={e => setExchangeDate(e.target.value)} />
                    </div>
                    <button onClick={doExchange} disabled={actionLoading || !exchangeAmount || !exchangeRate}>Exchange</button>
                  </div>
                  {exchangeAmount && exchangeRate && Number(exchangeAmount) > 0 && Number(exchangeRate) > 0 && (
                    <div className="pf-interest-preview">
                      Hesaplanan USD: <strong>${(Number(exchangeAmount) / Number(exchangeRate)).toFixed(4)}</strong>
                      &nbsp;| Kur: <strong>{Number(exchangeRate).toFixed(4)}</strong> TRY/USD
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ═══ TRADE TAB ═══ */}
            {tab === 'trade' && (
              <div className="pf-forms">
                {/* Category selector */}
                <div className="pf-category-select">
                  <span className="pf-category-label-text">Category:</span>
                  <button className={`pf-cat-btn ${tradeCategory === '' ? 'active' : ''}`} onClick={() => { setTradeCategory(''); setSearchQuery(''); setSearchResults([]); }}>All</button>
                  {TRADE_CATEGORIES.map(c => (
                    <button key={c.key} className={`pf-cat-btn ${tradeCategory === c.key ? 'active' : ''}`}
                      onClick={() => { setTradeCategory(c.key); setSearchQuery(''); setSearchResults([]); }}>
                      {c.icon} {c.label}
                    </button>
                  ))}
                </div>

                {/* Buy with search */}
                <div className="pf-form-card">
                  <h3>Buy Asset</h3>
                  <p className="pf-form-hint">
                    Cash available: {portfolio ? fmtUsd(portfolio.cash_usd) : '$0.00'}
                  </p>
                  <div className="pf-search-wrap">
                    <input type="text" placeholder="Search by name or symbol..."
                      value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setBuySymbol(''); }} />
                    {searchResults.length > 0 && (
                      <div className="pf-search-dropdown">
                        {searchResults.map(r => (
                          <div key={r.symbol} className="pf-search-item"
                            onClick={() => { setBuySymbol(r.symbol); setSearchQuery(r.symbol + ' — ' + r.name); setSearchResults([]); }}>
                            <span className="pf-search-sym">{r.symbol}</span>
                            <span className="pf-search-name">{r.name}</span>
                            <span className="pf-search-group">{r.group}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="pf-currency-toggle" style={{marginBottom: '10px'}}>
                    <button className={buyMode === 'quantity' ? 'active' : ''} onClick={() => setBuyMode('quantity')}>By Quantity</button>
                    <button className={buyMode === 'amount' ? 'active' : ''} onClick={() => setBuyMode('amount')}>By Amount ($)</button>
                  </div>
                  <div className="pf-input-row">
                    <div className="pf-labeled-input">
                      <label>Sembol</label>
                      <input type="text" placeholder="Symbol" value={buySymbol}
                        onChange={e => setBuySymbol(e.target.value)} readOnly={!!buySymbol && searchResults.length === 0} />
                    </div>
                    {buyMode === 'quantity' ? (
                      <div className="pf-labeled-input">
                        <label>Adet</label>
                        <input type="number" placeholder="0" value={buyQuantity} onChange={e => setBuyQuantity(e.target.value)} />
                      </div>
                    ) : (
                      <div className="pf-labeled-input">
                        <label>Tutar (USD)</label>
                        <input type="number" placeholder="0.00" value={buyAmount} onChange={e => setBuyAmount(e.target.value)} />
                      </div>
                    )}
                    <div className="pf-labeled-input">
                      <label>Birim Fiyat (USD)</label>
                      <input type="number" placeholder="0.0000" value={buyPrice} onChange={e => setBuyPrice(e.target.value)} step="0.0001" />
                    </div>
                    <div className="pf-labeled-input">
                      <label>Tarih</label>
                      <input type="date" value={buyDate} onChange={e => setBuyDate(e.target.value)} />
                    </div>
                    <button onClick={doBuy} disabled={actionLoading || !buySymbol || !buyPrice}>Buy</button>
                  </div>
                </div>

                {/* Sell */}
                <div className="pf-form-card">
                  <h3>Sell Asset</h3>
                  {portfolio && portfolio.holdings.length > 0 && (
                    <p className="pf-form-hint">
                      Holdings: {portfolio.holdings.map(h => `${h.symbol} (${(h.quantity ?? 0).toFixed(4)})`).join(', ')}
                    </p>
                  )}
                  <div className="pf-search-wrap">
                    <input type="text" placeholder="Search by name or symbol..."
                      value={sellSearchQuery} onChange={e => { setSellSearchQuery(e.target.value); setSellSymbol(''); }} />
                    {sellSearchResults.length > 0 && (
                      <div className="pf-search-dropdown">
                        {sellSearchResults.map(r => (
                          <div key={r.symbol} className="pf-search-item"
                            onClick={() => { setSellSymbol(r.symbol); setSellSearchQuery(r.symbol + ' — ' + r.name); setSellSearchResults([]); }}>
                            <span className="pf-search-sym">{r.symbol}</span>
                            <span className="pf-search-name">{r.name}</span>
                            <span className="pf-search-group">{r.group}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="pf-currency-toggle" style={{marginBottom: '10px'}}>
                    <button className={sellMode === 'quantity' ? 'active' : ''} onClick={() => setSellMode('quantity')}>By Quantity</button>
                    <button className={sellMode === 'amount' ? 'active' : ''} onClick={() => setSellMode('amount')}>By Amount ($)</button>
                  </div>
                  <div className="pf-input-row">
                    <div className="pf-labeled-input">
                      <label>Sembol</label>
                      <input type="text" placeholder="Symbol" value={sellSymbol}
                        onChange={e => setSellSymbol(e.target.value)} readOnly={!!sellSymbol && sellSearchResults.length === 0} />
                    </div>
                    {sellMode === 'quantity' ? (
                      <div className="pf-labeled-input">
                        <label>Adet</label>
                        <input type="number" placeholder="0" value={sellQuantity} onChange={e => setSellQuantity(e.target.value)} />
                      </div>
                    ) : (
                      <div className="pf-labeled-input">
                        <label>Tutar (USD)</label>
                        <input type="number" placeholder="0.00" value={sellAmount} onChange={e => setSellAmount(e.target.value)} />
                      </div>
                    )}
                    <div className="pf-labeled-input">
                      <label>Birim Fiyat (USD)</label>
                      <input type="number" placeholder="0.0000" value={sellPrice} onChange={e => setSellPrice(e.target.value)} step="0.0001" />
                    </div>
                    <div className="pf-labeled-input">
                      <label>Tarih</label>
                      <input type="date" value={sellDate} onChange={e => setSellDate(e.target.value)} />
                    </div>
                    <button onClick={doSell} disabled={actionLoading || !sellSymbol || !sellPrice}>Sell</button>
                  </div>
                </div>
              </div>
            )}

            {/* ═══ INTEREST TAB ═══ */}
            {tab === 'interest' && (
              <div className="pf-forms">
                <div className="pf-form-card">
                  <h3>Deposit to Interest</h3>
                  <div className="pf-currency-toggle">
                    <button className={interestCurrency === 'USD' ? 'active' : ''} onClick={() => setInterestCurrency('USD')}>$ USD</button>
                    <button className={interestCurrency === 'TRY' ? 'active' : ''} onClick={() => setInterestCurrency('TRY')}>₺ TRY</button>
                  </div>
                  <p className="pf-form-hint">
                    {interestCurrency === 'USD'
                      ? `Cash available: ${portfolio ? fmtUsd(portfolio.cash_usd) : '$0.00'}`
                      : `Cash available: ${portfolio ? fmtTry(portfolio.cash_try) : '₺0.00'}`
                    }. Specify amount, interest rate, date range, and payment interval.
                  </p>
                  <div className="pf-input-row">
                    <div className="pf-labeled-input">
                      <label>Miktar ({interestCurrency})</label>
                      <input type="number" placeholder="0.00" value={interestAmount} onChange={e => setInterestAmount(e.target.value)} />
                    </div>
                    <div className="pf-labeled-input">
                      <label>Yıllık Faiz (%)</label>
                      <input type="number" placeholder="0.00" value={interestRate} onChange={e => setInterestRate(e.target.value)} />
                    </div>
                  </div>
                  <div className="pf-input-row">
                    <div className="pf-labeled-input">
                      <label>Başlangıç Tarihi</label>
                      <input type="date" value={interestStartDate} onChange={e => setInterestStartDate(e.target.value)} />
                    </div>
                    <div className="pf-labeled-input">
                      <label>Bitiş Tarihi</label>
                      <input type="date" value={interestEndDate} onChange={e => setInterestEndDate(e.target.value)} />
                    </div>
                  </div>
                  <div className="pf-input-row">
                    <select value={interestPaymentInterval} onChange={e => setInterestPaymentInterval(e.target.value as any)}>
                      <option value="end">Pay at End</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                    <button onClick={doInterestIn} disabled={actionLoading}>Deposit {interestCurrency}</button>
                  </div>
                  {interestAmount && interestRate && interestStartDate && interestEndDate && (
                    <div className="pf-interest-preview">
                      {
                        (() => {
                          const start = new Date(interestStartDate);
                          const end = new Date(interestEndDate);
                          const days = Math.max(0, Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
                          const earned = Number(interestAmount) * (Number(interestRate) / 100) * (days / 365);
                          return (
                            <>
                              Estimated earnings for {days} days: <strong>
                                {(interestCurrency === 'USD' ? fmtUsd : fmtTry)(earned)}
                              </strong>
                              <span className="pf-interest-formula">
                                = {interestAmount} × ({interestRate}% ÷ 100) × ({days} ÷ 365), {interestPaymentInterval} payments
                              </span>
                            </>
                          );
                        })()
                      }
                    </div>
                  )}
                </div>

                {/* USD Interest Withdraw */}
                {portfolio && portfolio.interest_balance_usd > 0 && (
                  <div className="pf-form-card">
                    <h3>Withdraw USD Interest</h3>
                    <p className="pf-form-hint">
                      Current USD interest balance: {fmtUsd(portfolio.interest_balance_usd)}
                    </p>
                    <button className="pf-btn-full" onClick={() => doInterestOut('USD')} disabled={actionLoading}>
                      Withdraw All USD (Principal + Interest)
                    </button>
                  </div>
                )}

                {/* TRY Interest Withdraw */}
                {portfolio && portfolio.interest_balance_try > 0 && (
                  <div className="pf-form-card">
                    <h3>Withdraw TRY Interest</h3>
                    <p className="pf-form-hint">
                      Current TRY interest balance: {fmtTry(portfolio.interest_balance_try)}
                    </p>
                    <button className="pf-btn-full" onClick={() => doInterestOut('TRY')} disabled={actionLoading}>
                      Withdraw All TRY (Principal + Interest)
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ═══ HISTORY TAB ═══ */}
            {tab === 'history' && (
              <div className="pf-history">
                <h3>Transaction History</h3>
                {transactions.length === 0 ? (
                  <p className="pf-empty">No transactions yet. Start by making a deposit.</p>
                ) : (
                  <div className="pf-table-wrap">
                    <table className="pf-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Type</th>
                          <th>Symbol</th>
                          <th>Qty</th>
                          <th>USD</th>
                          <th>TRY</th>
                          <th>Rate</th>
                          <th>Note</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.map(tx => (
                          <tr key={tx.id}>
                            <td className="pf-td-date">
                              {tx.transaction_date 
                                ? new Date(tx.transaction_date).toLocaleDateString() 
                                : (tx.created_at ? new Date(tx.created_at).toLocaleString() : '-')}
                            </td>
                            <td>
                              <span className={`pf-tx-badge pf-tx-badge--${tx.type}`}>
                                {txTypeLabel[tx.type] || tx.type}
                              </span>
                            </td>
                            <td>{tx.symbol || '-'}</td>
                            <td>{tx.quantity != null ? tx.quantity.toFixed(4) : '-'}</td>
                            <td>{tx.amount_usd != null ? fmtUsd(tx.amount_usd) : '-'}</td>
                            <td>{tx.amount_try != null ? fmtTry(tx.amount_try) : '-'}</td>
                            <td>{tx.usd_try_rate != null ? tx.usd_try_rate.toFixed(4) : '-'}</td>
                            <td className="pf-td-note">{tx.note || '-'}</td>
                            <td>
                              {deleteConfirmId === tx.id ? (
                                <div className="pf-delete-confirm">
                                  <button 
                                    className="pf-btn-confirm-delete" 
                                    onClick={() => doDeleteTransaction(tx.id)}
                                    disabled={actionLoading}
                                  >
                                    ✓ Confirm
                                  </button>
                                  <button 
                                    className="pf-btn-cancel-delete" 
                                    onClick={() => setDeleteConfirmId(null)}
                                    disabled={actionLoading}
                                  >
                                    ✗ Cancel
                                  </button>
                                </div>
                              ) : (
                                <button 
                                  className="pf-btn-delete" 
                                  onClick={() => setDeleteConfirmId(tx.id)}
                                  disabled={actionLoading}
                                  title="Delete transaction"
                                >
                                  🗑️ Delete
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Portfolio;
