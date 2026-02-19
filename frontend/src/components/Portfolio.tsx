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
  nominal_pnl_try_pct: number;
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
type Tab = 'overview' | 'deposit' | 'trade' | 'interest' | 'history' | 'pnl';
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

  /* PnL state */
  const [pnlPeriod, setPnlPeriod] = useState<string>('all');
  const [pnlCustomStart, setPnlCustomStart] = useState('');
  const [pnlCustomEnd, setPnlCustomEnd] = useState('');
  const [pnlData, setPnlData] = useState<any>(null);
  const [pnlLoading, setPnlLoading] = useState(false);
  const [pnlError, setPnlError] = useState<string | null>(null);
  const [pnlFilterMode, setPnlFilterMode] = useState<'all' | 'select'>('all');
  const [pnlSelectedItems, setPnlSelectedItems] = useState<string[]>([]);

  /* Multi-portfolio state */
  const [portfolios, setPortfolios] = useState<{id: number; name: string; cash_usd: number; cash_try: number; created_at: string}[]>([]);
  const [activePortfolioId, setActivePortfolioId] = useState<number | null>(null);
  const [showPortfolioCreate, setShowPortfolioCreate] = useState(false);
  const [newPortfolioName, setNewPortfolioName] = useState('');
  const [editPortfolioId, setEditPortfolioId] = useState<number | null>(null);
  const [renamePortfolioName, setRenamePortfolioName] = useState('');

  /* Delete confirmation */
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const token = localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}` };

  const loadPortfolios = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/portfolios`, { headers });
      setPortfolios(res.data);
      if (res.data.length > 0 && !activePortfolioId) {
        setActivePortfolioId(res.data[0].id);
      }
    } catch (e: any) {
      console.error('Failed to load portfolios:', e);
    }
  }, [activePortfolioId]);

  const loadPortfolio = useCallback(async (pid?: number | null) => {
    try {
      const params: any = {};
      const id = pid ?? activePortfolioId;
      if (id) params.portfolio_id = id;
      const res = await axios.get(`${API_URL}/api/portfolio`, { headers, params });
      setPortfolio(res.data);
      setError(null);
    } catch (e: any) {
      console.error('Failed to load portfolio:', e);
      setError(e.response?.data?.detail || e.message || 'Failed to load portfolio data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [activePortfolioId]);

  const loadTransactions = useCallback(async (pid?: number | null) => {
    try {
      const params: any = {};
      const id = pid ?? activePortfolioId;
      if (id) params.portfolio_id = id;
      const res = await axios.get(`${API_URL}/api/portfolio/transactions`, { headers, params });
      setTransactions(res.data);
    } catch (e: any) {
      console.error(e);
    }
  }, [activePortfolioId]);

  const loadPnl = useCallback(async (p: string, customStart?: string, customEnd?: string) => {
    setPnlLoading(true);
    setPnlError(null);
    try {
      const params: any = {};
      if (activePortfolioId) params.portfolio_id = activePortfolioId;
      if (p === 'custom') {
        if (!customStart) { setPnlError('Başlangıç tarihi gerekli'); setPnlLoading(false); return; }
        params.start_date = customStart;
        if (customEnd) params.end_date = customEnd;
      } else {
        params.period = p;
      }
      if (pnlFilterMode === 'select' && pnlSelectedItems.length > 0) {
        params.symbols = pnlSelectedItems.join(',');
      }
      const res = await axios.get(`${API_URL}/api/portfolio/pnl`, { headers, params });
      setPnlData(res.data);
    } catch (e: any) {
      setPnlError(e.response?.data?.detail || 'PnL hesaplanamadı');
    } finally {
      setPnlLoading(false);
    }
  }, [activePortfolioId, pnlFilterMode, pnlSelectedItems]);

  const switchPortfolio = (pid: number) => {
    setActivePortfolioId(pid);
    setLoading(true);
    setPnlData(null);
    loadPortfolio(pid);
    loadTransactions(pid);
  };

  const createPortfolio = async () => {
    if (!newPortfolioName.trim()) return;
    try {
      await axios.post(`${API_URL}/api/portfolios`, { name: newPortfolioName.trim() }, { headers });
      setNewPortfolioName('');
      setShowPortfolioCreate(false);
      flashMsg('Yeni portföy oluşturuldu');
      loadPortfolios();
    } catch (e: any) {
      flashMsg(e.response?.data?.detail || 'Portföy oluşturulamadı', true);
    }
  };

  const doRenamePortfolio = async () => {
    if (!editPortfolioId || !renamePortfolioName.trim()) return;
    try {
      await axios.put(`${API_URL}/api/portfolios/${editPortfolioId}`, { name: renamePortfolioName.trim() }, { headers });
      setEditPortfolioId(null);
      setRenamePortfolioName('');
      flashMsg('Portföy adı güncellendi');
      loadPortfolios();
    } catch (e: any) {
      flashMsg(e.response?.data?.detail || 'İsim değiştirilemedi', true);
    }
  };

  const doDeletePortfolio = async (pid: number) => {
    try {
      await axios.delete(`${API_URL}/api/portfolios/${pid}`, { headers });
      flashMsg('Portföy silindi');
      loadPortfolios();
      if (activePortfolioId === pid) {
        setActivePortfolioId(null);
        loadPortfolios();
      }
    } catch (e: any) {
      flashMsg(e.response?.data?.detail || 'Portföy silinemedi', true);
    }
  };

  useEffect(() => {
    loadPortfolios();
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
    const isBist = buySymbol.toUpperCase().endsWith('.IS');
    try {
      const body: any = {
        symbol: buySymbol.toUpperCase(),
        custom_price: Number(buyPrice),
        portfolio_id: activePortfolioId,
      };
      if (buyMode === 'quantity') body.quantity = Number(buyQuantity);
      else if (isBist) body.amount_try = Number(buyAmount);
      else body.amount_usd = Number(buyAmount);
      if (buyDate) body.transaction_date = buyDate;
      const res = await axios.post(`${API_URL}/api/portfolio/buy`, body, { headers });
      const cur = isBist ? '₺' : '$';
      const price = isBist ? (res.data.price_try ?? 0) : (res.data.price_usd ?? 0);
      flashMsg(`Bought ${buyMode === 'quantity' ? buyQuantity : res.data.quantity} ${buySymbol.toUpperCase()} at ${cur}${price.toFixed(4)}`);
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
    const isBist = sellSymbol.toUpperCase().endsWith('.IS');
    try {
      const body: any = {
        symbol: sellSymbol.toUpperCase(),
        custom_price: Number(sellPrice),
        portfolio_id: activePortfolioId,
      };
      if (sellMode === 'quantity') body.quantity = Number(sellQuantity);
      else if (isBist) body.amount_try = Number(sellAmount);
      else body.amount_usd = Number(sellAmount);
      if (sellDate) body.transaction_date = sellDate;
      const res = await axios.post(`${API_URL}/api/portfolio/sell`, body, { headers });
      const cur = isBist ? '₺' : '$';
      const price = isBist ? (res.data.price_try ?? 0) : (res.data.price_usd ?? 0);
      flashMsg(`Sold ${sellMode === 'quantity' ? sellQuantity : res.data.quantity} ${sellSymbol.toUpperCase()} at ${cur}${price.toFixed(4)}`);
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
  const getSymbolGroup = (symbol: string): string => {
    if (symbol.endsWith('.IS')) return 'bist100';
    if (symbol.endsWith('-USD') && !symbol.includes('=')) return 'crypto';
    if (symbol.includes('=F')) return 'commodity';
    if (symbol.includes('=X')) return 'forex';
    return 'sp500';
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
    { id: 'pnl', label: '📊 PnL / Performance' },
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

        {/* ── Portfolio selector ── */}
        {portfolios.length > 0 && (
          <div className="pf-portfolio-selector">
            <div className="pf-portfolio-list">
              {portfolios.map(p => (
                <div key={p.id} className={`pf-portfolio-chip ${activePortfolioId === p.id ? 'active' : ''}`}>
                  {editPortfolioId === p.id ? (
                    <span className="pf-portfolio-edit">
                      <input
                        type="text" value={renamePortfolioName}
                        onChange={e => setRenamePortfolioName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && doRenamePortfolio()}
                        autoFocus
                      />
                      <button onClick={doRenamePortfolio}>✓</button>
                      <button onClick={() => setEditPortfolioId(null)}>✗</button>
                    </span>
                  ) : (
                    <>
                      <span className="pf-portfolio-name" onClick={() => switchPortfolio(p.id)}>{p.name}</span>
                      {activePortfolioId === p.id && (
                        <span className="pf-portfolio-actions">
                          <button title="Rename" onClick={() => { setEditPortfolioId(p.id); setRenamePortfolioName(p.name); }}>✎</button>
                          {portfolios.length > 1 && (
                            <button title="Delete" onClick={() => doDeletePortfolio(p.id)}>✕</button>
                          )}
                        </span>
                      )}
                    </>
                  )}
                </div>
              ))}
              {showPortfolioCreate ? (
                <div className="pf-portfolio-chip pf-portfolio-create-inline">
                  <input type="text" placeholder="Portföy adı..." value={newPortfolioName}
                    onChange={e => setNewPortfolioName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && createPortfolio()} autoFocus />
                  <button onClick={createPortfolio}>✓</button>
                  <button onClick={() => { setShowPortfolioCreate(false); setNewPortfolioName(''); }}>✗</button>
                </div>
              ) : (
                <button className="pf-portfolio-add-btn" onClick={() => setShowPortfolioCreate(true)}>+ Yeni Portföy</button>
              )}
            </div>
          </div>
        )}

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
                {/* Balance card */}
                <div className="pf-balance-grid">
                  <div className="pf-balance-card pf-balance-card--main">
                    <span className="pf-bal-label">Total Value</span>
                    <span className="pf-bal-usd">{fmtUsd(portfolio.total_value_usd)}</span>
                    <span className="pf-bal-try">{fmtTry(portfolio.total_value_try)}</span>
                  </div>
                </div>

                {/* P&L section */}
                <div className="pf-pnl-section">
                  <h3>Profit & Loss</h3>
                  <div className="pf-pnl-grid">
                    <div className="pf-pnl-card">
                      <span className="pf-pnl-label">Total Deposited</span>
                      <span className="pf-pnl-value">{fmtUsd(portfolio.total_deposited_usd)}</span>
                      <span className="pf-pnl-sub">{fmtTry(portfolio.total_deposited_try)}</span>
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
                        <span className={`pf-pnl-sub ${pnlClass(portfolio.nominal_pnl_try_pct ?? 0)}`}>
                          {pnlSign(portfolio.nominal_pnl_try_pct ?? 0)}{(portfolio.nominal_pnl_try_pct ?? 0).toFixed(2)}%
                        </span>
                      </div>
                    )}
                    <div className="pf-pnl-card">
                      <span className="pf-pnl-label">Inflation-Adjusted P&L</span>
                      <span className={`pf-pnl-value ${pnlClass(portfolio.inflation_adjusted_pnl_usd)}`}>
                        {(() => {
                          const reqVal = (portfolio.total_deposited_usd || 0) * (portfolio.inflation_factor || 1);
                          const inflPct = reqVal > 0 ? ((portfolio.inflation_adjusted_pnl_usd / reqVal) * 100) : 0;
                          return `${pnlSign(inflPct)}${inflPct.toFixed(2)}%`;
                        })()}
                      </span>
                      <span className="pf-pnl-sub">Enflasyon Çarpanı: {(portfolio.inflation_factor ?? 1).toFixed(6)}</span>
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

                </div>

                {/* Holdings grouped by category */}
                {(portfolio.holdings.length > 0 || portfolio.interest_balance_usd > 0 || portfolio.interest_balance_try > 0) && (
                  <div className="pf-holdings-section">
                    <h3>Holdings</h3>

                    {/* Cash balances */}
                    {(portfolio.cash_usd > 0 || portfolio.cash_try > 0) && (
                      <div className="pf-holdings-group">
                        <h4>💵 Cash</h4>
                        <div className="pf-holdings-group-items">
                          {portfolio.cash_usd > 0 && (
                            <div className="pf-holding-item">
                              <span>Cash (USD)</span><span>{fmtUsd(portfolio.cash_usd)}</span>
                            </div>
                          )}
                          {portfolio.cash_try > 0 && (
                            <div className="pf-holding-item">
                              <span>Cash (TRY)</span><span>{fmtTry(portfolio.cash_try)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Interest balances */}
                    {(portfolio.interest_balance_usd > 0 || portfolio.interest_balance_try > 0) && (
                      <div className="pf-holdings-group">
                        <h4>💰 Interest</h4>
                        <div className="pf-holdings-group-items">
                          {portfolio.interest_balance_usd > 0 && (
                            <div className="pf-holding-item">
                              <span>Interest (USD)</span><span>{fmtUsd(portfolio.interest_balance_usd)}</span>
                            </div>
                          )}
                          {portfolio.interest_balance_try > 0 && (
                            <div className="pf-holding-item">
                              <span>Interest (TRY)</span><span>{fmtTry(portfolio.interest_balance_try)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Grouped asset holdings */}
                    {(() => {
                      const groups: Record<string, Holding[]> = {};
                      portfolio.holdings.forEach(h => {
                        const g = getSymbolGroup(h.symbol);
                        if (!groups[g]) groups[g] = [];
                        groups[g].push(h);
                      });
                      const groupLabels: Record<string, string> = {
                        crypto: '₿ Crypto', commodity: '🪙 Commodities',
                        bist100: '🇹🇷 BIST 100', sp500: '📊 S&P 500', forex: '💱 Forex',
                      };
                      return Object.entries(groups).map(([g, items]) => (
                        <div key={g} className="pf-holdings-group">
                          <h4>{groupLabels[g] || g}</h4>
                          <div className="pf-table-wrap">
                            <table className="pf-table">
                              <thead>
                                <tr>
                                  <th>Symbol</th><th>Qty</th><th>Avg Cost</th>
                                  <th>Price</th><th>Value</th><th>P&L</th><th>P&L %</th>
                                </tr>
                              </thead>
                              <tbody>
                                {items.map(h => (
                                  <tr key={h.symbol}>
                                    <td className="pf-td-sym">{h.symbol}</td>
                                    <td>{(h.quantity ?? 0).toFixed(4)}</td>
                                    <td>{fmtUsd(h.avg_cost_usd)}</td>
                                    <td>{fmtUsd(h.current_price_usd)}</td>
                                    <td>{fmtUsd(h.market_value_usd)}</td>
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
                      ));
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* ═══ PNL / PERFORMANS TAB ═══ */}
            {tab === 'pnl' && (
              <div className="pf-pnl">
                {/* Period selector */}
                <div className="pf-pnl-periods">
                  {[
                    { key: '1m', label: '1M' },
                    { key: '3m', label: '3M' },
                    { key: '1y', label: '1Y' },
                    { key: '5y', label: '5Y' },
                    { key: 'all', label: 'All' },
                  ].map(p => (
                    <button
                      key={p.key}
                      className={`pf-pnl-period-btn ${pnlPeriod === p.key ? 'active' : ''}`}
                      onClick={() => { setPnlPeriod(p.key); loadPnl(p.key); }}
                      disabled={pnlLoading}
                    >
                      {p.label}
                    </button>
                  ))}
                  <button
                    className={`pf-pnl-period-btn ${pnlPeriod === 'custom' ? 'active' : ''}`}
                    onClick={() => setPnlPeriod('custom')}
                    disabled={pnlLoading}
                  >
                    Custom Period
                  </button>
                </div>

                {/* Asset filter */}
                <div className="pf-pnl-filter">
                  <div className="pf-currency-toggle" style={{marginBottom: '8px'}}>
                    <button className={pnlFilterMode === 'all' ? 'active' : ''} onClick={() => { setPnlFilterMode('all'); setPnlSelectedItems([]); }}>All Portfolio</button>
                    <button className={pnlFilterMode === 'select' ? 'active' : ''} onClick={() => setPnlFilterMode('select')}>Selected Assets</button>
                  </div>
                  {pnlFilterMode === 'select' && portfolio && (
                    <div className="pf-pnl-filter-items">
                      {[
                        { key: 'cash_try', label: '₺ Nakit (TRY)' },
                        { key: 'cash_usd', label: '$ Nakit (USD)' },
                        ...(portfolio.interest_balance_usd > 0 ? [{ key: 'interest_usd', label: '$ Faiz (USD)' }] : []),
                        ...(portfolio.interest_balance_try > 0 ? [{ key: 'interest_try', label: '₺ Faiz (TRY)' }] : []),
                        ...portfolio.holdings.map(h => ({ key: h.symbol, label: `${h.symbol} (${h.quantity.toFixed(2)})` })),
                      ].map(item => (
                        <label key={item.key} className="pf-pnl-filter-check">
                          <input type="checkbox" checked={pnlSelectedItems.includes(item.key)}
                            onChange={e => {
                              if (e.target.checked) setPnlSelectedItems(prev => [...prev, item.key]);
                              else setPnlSelectedItems(prev => prev.filter(x => x !== item.key));
                            }} />
                          {item.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Custom date range */}
                {pnlPeriod === 'custom' && (
                  <div className="pf-pnl-custom">
                    <div className="pf-labeled-input">
                      <label>Start Date</label>
                      <input type="date" value={pnlCustomStart} onChange={e => setPnlCustomStart(e.target.value)} />
                    </div>
                    <div className="pf-labeled-input">
                      <label>End Date</label>
                      <input type="date" value={pnlCustomEnd} onChange={e => setPnlCustomEnd(e.target.value)} />
                    </div>
                    <button
                      className="pf-pnl-calc-btn"
                      onClick={() => loadPnl('custom', pnlCustomStart, pnlCustomEnd)}
                      disabled={pnlLoading || !pnlCustomStart}
                    >
                      Calculate
                    </button>
                  </div>
                )}

                {/* Loading */}
                {pnlLoading && (
                  <div className="pf-pnl-loading">
                    <div className="pf-pnl-spinner" />
                    Calculating... Fetching price data.
                  </div>
                )}

                {/* Error */}
                {pnlError && <div className="pf-msg pf-msg--error">{pnlError}</div>}

                {/* Results */}
                {pnlData && !pnlLoading && (
                  <>
                    {/* Period info */}
                    <div className="pf-pnl-period-info">
                      📅 {pnlData.period.start_date} — {pnlData.period.end_date}
                      <span>({pnlData.period.total_days} gün)</span>
                    </div>

                    {/* ── TRY PnL Card ── */}
                    <div className="pf-pnl-card">
                      <div className="pf-pnl-card-header">
                        <h3>₺ TRY-Based Profit & Loss</h3>
                        <div className={`pf-pnl-big ${pnlData.try_pnl.pnl >= 0 ? 'positive' : 'negative'}`}>
                          {pnlData.try_pnl.pnl >= 0 ? '+' : ''}₺{pnlData.try_pnl.pnl.toLocaleString('tr-TR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                          <span className="pf-pnl-pct">({pnlData.try_pnl.pnl_pct >= 0 ? '+' : ''}{pnlData.try_pnl.pnl_pct}%)</span>
                        </div>
                      </div>
                      <div className="pf-pnl-breakdown">
                        <div className="pf-pnl-row"><span>Starting Portfolio Value</span><span>₺{pnlData.try_pnl.start_value.toLocaleString('tr-TR', {minimumFractionDigits: 2})}</span></div>
                        <div className="pf-pnl-row pf-pnl-row--in"><span>+ Inflows</span><span>₺{pnlData.try_pnl.inflows.toLocaleString('tr-TR', {minimumFractionDigits: 2})}</span></div>
                        <div className="pf-pnl-row pf-pnl-row--out"><span>− Outflows</span><span>₺{pnlData.try_pnl.outflows.toLocaleString('tr-TR', {minimumFractionDigits: 2})}</span></div>
                        <div className="pf-pnl-row pf-pnl-row--total"><span>Cost Basis</span><span>₺{(pnlData.try_pnl.start_value + pnlData.try_pnl.inflows - pnlData.try_pnl.outflows).toLocaleString('tr-TR', {minimumFractionDigits: 2})}</span></div>
                        <hr />
                        <div className="pf-pnl-row"><span>Ending Portfolio Value</span><span>₺{pnlData.try_pnl.end_value.toLocaleString('tr-TR', {minimumFractionDigits: 2})}</span></div>
                        <hr />
                        <div className={`pf-pnl-row pf-pnl-row--result ${pnlData.try_pnl.pnl >= 0 ? 'positive' : 'negative'}`}>
                          <span>Profit/Loss</span>
                          <span>{pnlData.try_pnl.pnl >= 0 ? '+' : ''}₺{pnlData.try_pnl.pnl.toLocaleString('tr-TR', {minimumFractionDigits: 2})} ({pnlData.try_pnl.pnl_pct >= 0 ? '+' : ''}{pnlData.try_pnl.pnl_pct}%)</span>
                        </div>
                      </div>
                      <div className="pf-pnl-rate-info">
                        Rate: {pnlData.try_pnl.start_rate} → {pnlData.try_pnl.end_rate} TRY/USD
                      </div>

                      {/* End composition */}
                      <details className="pf-pnl-details">
                        <summary>Portfolio Composition (End)</summary>
                        <div className="pf-pnl-composition">
                          <div className="pf-pnl-comp-row"><span>₺ Cash</span><span>₺{pnlData.end_valuation.cash_try.toLocaleString('tr-TR', {minimumFractionDigits: 2})}</span></div>
                          <div className="pf-pnl-comp-row"><span>$ Cash</span><span>${pnlData.end_valuation.cash_usd.toFixed(4)} × {pnlData.end_valuation.rate} = ₺{(pnlData.end_valuation.cash_usd * pnlData.end_valuation.rate).toLocaleString('tr-TR', {minimumFractionDigits: 2})}</span></div>
                          {pnlData.end_valuation.interest_usd > 0 && <div className="pf-pnl-comp-row"><span>Interest (USD)</span><span>${pnlData.end_valuation.interest_usd.toFixed(4)}</span></div>}
                          {pnlData.end_valuation.interest_try > 0 && <div className="pf-pnl-comp-row"><span>Interest (TRY)</span><span>₺{pnlData.end_valuation.interest_try.toLocaleString('tr-TR', {minimumFractionDigits: 2})}</span></div>}
                          {pnlData.end_valuation.holdings_detail?.map((h: any) => (
                            <div key={h.symbol} className="pf-pnl-comp-row">
                              <span>{h.symbol} ({h.qty}×{h.is_bist ? '₺' : '$'}{h.price.toFixed(2)})</span>
                              <span>₺{h.value_try.toLocaleString('tr-TR', {minimumFractionDigits: 2})}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>

                    {/* ── USD PnL Card ── */}
                    <div className="pf-pnl-card">
                      <div className="pf-pnl-card-header">
                        <h3>$ USD-Based Profit & Loss</h3>
                        <div className={`pf-pnl-big ${pnlData.usd_pnl.pnl >= 0 ? 'positive' : 'negative'}`}>
                          {pnlData.usd_pnl.pnl >= 0 ? '+' : ''}${pnlData.usd_pnl.pnl.toFixed(4)}
                          <span className="pf-pnl-pct">({pnlData.usd_pnl.pnl_pct >= 0 ? '+' : ''}{pnlData.usd_pnl.pnl_pct}%)</span>
                        </div>
                      </div>
                      <div className="pf-pnl-breakdown">
                        <div className="pf-pnl-row"><span>Starting Portfolio Value</span><span>${pnlData.usd_pnl.start_value.toFixed(4)}</span></div>
                        <div className="pf-pnl-row pf-pnl-row--in"><span>+ Inflows</span><span>${pnlData.usd_pnl.inflows.toFixed(4)}</span></div>
                        <div className="pf-pnl-row pf-pnl-row--out"><span>− Outflows</span><span>${pnlData.usd_pnl.outflows.toFixed(4)}</span></div>
                        <div className="pf-pnl-row pf-pnl-row--total"><span>Cost Basis</span><span>${(pnlData.usd_pnl.start_value + pnlData.usd_pnl.inflows - pnlData.usd_pnl.outflows).toFixed(4)}</span></div>
                        <hr />
                        <div className="pf-pnl-row"><span>Ending Portfolio Value</span><span>${pnlData.usd_pnl.end_value.toFixed(4)}</span></div>
                        <hr />
                        <div className={`pf-pnl-row pf-pnl-row--result ${pnlData.usd_pnl.pnl >= 0 ? 'positive' : 'negative'}`}>
                          <span>Profit/Loss</span>
                          <span>{pnlData.usd_pnl.pnl >= 0 ? '+' : ''}${pnlData.usd_pnl.pnl.toFixed(4)} ({pnlData.usd_pnl.pnl_pct >= 0 ? '+' : ''}{pnlData.usd_pnl.pnl_pct}%)</span>
                        </div>
                      </div>

                      <details className="pf-pnl-details">
                        <summary>Portfolio Composition (End)</summary>
                        <div className="pf-pnl-composition">
                          <div className="pf-pnl-comp-row"><span>$ Cash</span><span>${pnlData.end_valuation.cash_usd.toFixed(4)}</span></div>
                          <div className="pf-pnl-comp-row"><span>₺ Cash</span><span>₺{pnlData.end_valuation.cash_try.toLocaleString('tr-TR', {minimumFractionDigits: 2})} ÷ {pnlData.end_valuation.rate} = ${(pnlData.end_valuation.cash_try / pnlData.end_valuation.rate).toFixed(4)}</span></div>
                          {pnlData.end_valuation.holdings_detail?.map((h: any) => (
                            <div key={h.symbol} className="pf-pnl-comp-row">
                              <span>{h.symbol} ({h.qty}×{h.is_bist ? '₺' : '$'}{h.price.toFixed(2)})</span>
                              <span>${h.value_usd.toFixed(4)}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>

                    {/* ── Inflation-Adjusted PnL Card ── */}
                    {pnlData.inflation_pnl && (
                    <div className="pf-pnl-card pf-pnl-card--inflation">
                      <div className="pf-pnl-card-header">
                        <h3>📊 Real Return (Inflation-Adjusted)</h3>
                        <div className={`pf-pnl-big ${pnlData.inflation_pnl.real_pnl_pct >= 0 ? 'positive' : 'negative'}`}>
                          {pnlData.inflation_pnl.real_pnl_pct >= 0 ? '+' : ''}{pnlData.inflation_pnl.real_pnl_pct}%
                        </div>
                      </div>

                      <div className="pf-pnl-breakdown">
                        <div className="pf-pnl-row"><span>Current Value</span><span>${pnlData.inflation_pnl.current_value.toFixed(4)}</span></div>
                        <div className="pf-pnl-row"><span>Required Value (Inflation-Adjusted)</span><span>${pnlData.inflation_pnl.required_value.toFixed(4)}</span></div>
                        <div className="pf-pnl-row"><span>Period Total Inflation</span><span>{pnlData.inflation_pnl.total_inflation_pct}%</span></div>
                        <hr />
                        <div className={`pf-pnl-row pf-pnl-row--result ${pnlData.inflation_pnl.real_pnl_pct >= 0 ? 'positive' : 'negative'}`}>
                          <span>Real Return</span>
                          <span>{pnlData.inflation_pnl.real_pnl_pct >= 0 ? '+' : ''}{pnlData.inflation_pnl.real_pnl_pct}%</span>
                        </div>
                      </div>

                      {/* CPI Data Table */}
                      <details className="pf-pnl-details" open>
                        <summary>US CPI-U Data Used</summary>
                        <div className="pf-pnl-table-wrap">
                          <table className="pf-pnl-table">
                            <thead>
                              <tr><th>Period</th><th>CPI Value</th><th>Quarterly Inflation</th><th>Status</th></tr>
                            </thead>
                            <tbody>
                              {pnlData.inflation_pnl.cpi_data?.map((c: any, i: number) => (
                                <tr key={i} className={c.status !== 'published' && c.status !== 'açıklanmış' ? 'pf-pnl-estimated' : ''}>
                                  <td>{c.period}</td>
                                  <td>{c.cpi_value?.toFixed(1) ?? '—'}</td>
                                  <td>{c.quarterly_pct}%</td>
                                  <td><span className={`pf-pnl-status ${c.status === 'published' || c.status === 'açıklanmış' ? 'published' : 'estimated'}`}>{c.status === 'açıklanmış' ? 'published' : (c.status === 'tahmini' ? 'estimated' : c.status)}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>

                      {/* Per-deposit inflation breakdown */}
                      <details className="pf-pnl-details" open>
                        <summary>Inflation Calculation (Per Deposit)</summary>
                        <div className="pf-pnl-table-wrap">
                          <table className="pf-pnl-table">
                            <thead>
                              <tr><th>Description</th><th>Amount ($)</th><th>Date</th><th>Days Held</th><th>Infl. Factor</th><th>Adjusted ($)</th><th>Inflation Cost</th></tr>
                            </thead>
                            <tbody>
                              {pnlData.inflation_pnl.details?.map((d: any, i: number) => (
                                <tr key={i}>
                                  <td>{d.description}</td>
                                  <td>${d.amount_usd.toFixed(4)}</td>
                                  <td>{d.date}</td>
                                  <td>{d.days_held}</td>
                                  <td>×{d.inflation_multiplier.toFixed(4)}</td>
                                  <td>${d.adjusted_amount.toFixed(4)}</td>
                                  <td className={d.inflation_cost > 0 ? 'negative' : 'positive'}>${d.inflation_cost.toFixed(4)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>

                      {/* Method explanation */}
                      <details className="pf-pnl-details">
                        <summary>Calculation Methodology</summary>
                        <div className="pf-pnl-method">
                          <p><strong>Overview:</strong> This system calculates inflation-adjusted portfolio returns using US Consumer Price Index for All Urban Consumers (CPI-U) data published by the U.S. Bureau of Labor Statistics. The methodology accounts for the time-value erosion of each deposit based on quarterly inflation rates.</p>
                          
                          <p><strong>Data Sources:</strong></p>
                          <ul>
                            <li><strong>Published CPI-U:</strong> Historical quarterly values from the U.S. Bureau of Labor Statistics</li>
                            <li><strong>Projected CPI-U:</strong> For future quarters, we use linear extrapolation based on the expected annual inflation rate</li>
                            <li><strong>Current Source:</strong> {pnlData.inflation_pnl.method}</li>
                          </ul>

                          <p><strong>Calculation Process:</strong></p>
                          <ol>
                            <li><strong>Identify All Cash Flows:</strong> Track each deposit and withdrawal with its transaction date and USD-equivalent amount</li>
                            <li><strong>Determine Quarter Coverage:</strong> For each deposit, identify all quarters from deposit date to the analysis end date</li>
                            <li><strong>Calculate Quarterly Inflation Rate:</strong> For each quarter Q, compute the inflation rate as:<br/>
                              <code>inflation_rate_Q = ((CPI_Q_end - CPI_Q_start) / CPI_Q_start)</code>
                            </li>
                            <li><strong>Compute Partial Quarter Multipliers:</strong> If a deposit occurs mid-quarter, calculate the fractional exposure:<br/>
                              <code>fraction = days_in_quarter_after_deposit / total_days_in_quarter</code><br/>
                              <code>partial_multiplier = (1 + inflation_rate_Q)^fraction</code>
                            </li>
                            <li><strong>Aggregate Inflation Factor:</strong> For each deposit, multiply all quarterly factors:<br/>
                              <code>total_factor = ∏(1 + inflation_rate_Q)^(exposure_fraction_Q)</code>
                            </li>
                            <li><strong>Calculate Required Value:</strong> Sum the inflation-adjusted value of all deposits:<br/>
                              <code>Required_Value = Σ(Deposit_Amount × total_factor)</code>
                            </li>
                            <li><strong>Compute Real Return:</strong><br/>
                              <code>Real_Return_$ = Current_Portfolio_Value - Required_Value</code><br/>
                              <code>Real_Return_% = (Real_Return_$ / Required_Value) × 100</code>
                            </li>
                          </ol>

                          <div className="pf-pnl-formula">
                            <strong>Mathematical Formulas:</strong><br/><br/>
                            
                            <strong>1. Quarterly Inflation Rate:</strong><br/>
                            <code>r_q = (CPI_end - CPI_start) / CPI_start</code><br/><br/>
                            
                            <strong>2. Partial Quarter Multiplier (when deposit is mid-quarter):</strong><br/>
                            <code>m_partial = (1 + r_q)^(d_held / d_total)</code><br/>
                            where <code>d_held</code> = days from deposit to quarter end, <code>d_total</code> = total days in quarter<br/><br/>
                            
                            <strong>3. Full Quarter Multiplier:</strong><br/>
                            <code>m_full = (1 + r_q)</code><br/><br/>
                            
                            <strong>4. Total Inflation Factor for a Single Deposit:</strong><br/>
                            <code>F_deposit = m_partial_start × ∏(m_full_q) × m_partial_end</code><br/>
                            where the product ∏ is taken over all complete quarters between deposit and analysis end date<br/><br/>
                            
                            <strong>5. Required Value (Inflation-Adjusted Cost Basis):</strong><br/>
                            <code>V_required = Σ(Amount_i × F_deposit_i) - Σ(Withdrawal_j × F_withdrawal_j)</code><br/>
                            where <code>i</code> indexes deposits and <code>j</code> indexes withdrawals<br/><br/>
                            
                            <strong>6. Current Value:</strong><br/>
                            <code>V_current = Cash_USD + Cash_TRY/Rate + Σ(Holdings_value_USD) + Interest_Deposits</code><br/><br/>
                            
                            <strong>7. Real Return (Absolute):</strong><br/>
                            <code>R_real = V_current - V_required</code><br/><br/>
                            
                            <strong>8. Real Return (Percentage):</strong><br/>
                            <code>R_real_% = (R_real / V_required) × 100</code><br/><br/>
                            
                            <strong>Example:</strong><br/>
                            Suppose you deposit <strong>$10,000</strong> on <strong>Feb 15, 2025</strong>, and analyze on <strong>Aug 31, 2025</strong>.<br/>
                            <ul>
                              <li>Q1 2025 (Jan-Mar): CPI = 310.5 → 312.8, inflation = 0.74%, you're exposed for 44/90 days → multiplier = 1.0074^(44/90) = 1.0036</li>
                              <li>Q2 2025 (Apr-Jun): CPI = 312.8 → 315.2, inflation = 0.77%, full quarter → multiplier = 1.0077</li>
                              <li>Q3 2025 (Jul-Sep): CPI = 315.2 → 317.9, inflation = 0.86%, you're exposed for 62/92 days → multiplier = 1.0086^(62/92) = 1.0058</li>
                            </ul>
                            Total factor = 1.0036 × 1.0077 × 1.0058 = <strong>1.0172</strong><br/>
                            Required Value = $10,000 × 1.0172 = <strong>$10,172</strong><br/>
                            If Current Value = $10,500, Real Return = $10,500 - $10,172 = <strong>$328</strong> or <strong>+3.22%</strong>
                          </div>

                          <p><strong>Key Assumptions:</strong></p>
                          <ul>
                            <li>Inflation compounds continuously within each quarter</li>
                            <li>CPI-U is representative of purchasing power erosion for USD-denominated assets</li>
                            <li>Future quarters use projected inflation rates (clearly marked as "estimated")</li>
                            <li>All deposits and withdrawals are converted to USD equivalent at transaction date exchange rates</li>
                          </ul>

                          <p><strong>Interpretation:</strong></p>
                          <ul>
                            <li><strong>Positive Real Return:</strong> Your portfolio has grown faster than inflation — you've increased purchasing power</li>
                            <li><strong>Negative Real Return:</strong> Your portfolio has grown slower than inflation — you've lost purchasing power</li>
                            <li><strong>Zero Real Return:</strong> Your portfolio has exactly kept pace with inflation — purchasing power maintained</li>
                          </ul>
                        </div>
                      </details>
                    </div>
                    )}

                    {/* Cash flows table */}
                    {pnlData.flows && pnlData.flows.length > 0 && (
                      <details className="pf-pnl-details">
                        <summary>Cash Flows During Period ({pnlData.flows.length})</summary>
                        <div className="pf-pnl-table-wrap">
                          <table className="pf-pnl-table">
                            <thead>
                              <tr><th>Date</th><th>Type</th><th>TRY</th><th>USD</th><th>Rate</th></tr>
                            </thead>
                            <tbody>
                              {pnlData.flows.map((f: any, i: number) => (
                                <tr key={i}>
                                  <td>{f.date}</td>
                                  <td>{f.type === 'deposit' ? '➕ Inflow' : '➖ Outflow'}</td>
                                  <td className={f.amount_try >= 0 ? 'positive' : 'negative'}>₺{Math.abs(f.amount_try).toLocaleString('tr-TR', {minimumFractionDigits: 2})}</td>
                                  <td className={f.amount_usd >= 0 ? 'positive' : 'negative'}>${Math.abs(f.amount_usd).toFixed(4)}</td>
                                  <td>{f.rate}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                  </>
                )}

                {/* Initial prompt */}
                {!pnlData && !pnlLoading && !pnlError && (
                  <div className="pf-pnl-prompt">
                    Select a period to start performance analysis.
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
                    {buySymbol && buySymbol.toUpperCase().endsWith('.IS')
                      ? `BIST — TRY ile alınır. Mevcut: ${portfolio ? fmtTry(portfolio.cash_try) : '₺0.00'}`
                      : `Cash available: ${portfolio ? fmtUsd(portfolio.cash_usd) : '$0.00'}`}
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
                    <button className={buyMode === 'amount' ? 'active' : ''} onClick={() => setBuyMode('amount')}>
                      {buySymbol && buySymbol.toUpperCase().endsWith('.IS') ? 'By Amount (₺)' : 'By Amount ($)'}
                    </button>
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
                        <label>Tutar ({buySymbol && buySymbol.toUpperCase().endsWith('.IS') ? 'TRY' : 'USD'})</label>
                        <input type="number" placeholder="0.00" value={buyAmount} onChange={e => setBuyAmount(e.target.value)} />
                      </div>
                    )}
                    <div className="pf-labeled-input">
                      <label>Birim Fiyat ({buySymbol && buySymbol.toUpperCase().endsWith('.IS') ? 'TRY' : 'USD'})</label>
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
                    <button className={sellMode === 'amount' ? 'active' : ''} onClick={() => setSellMode('amount')}>
                      {sellSymbol && sellSymbol.toUpperCase().endsWith('.IS') ? 'By Amount (₺)' : 'By Amount ($)'}
                    </button>
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
                        <label>Tutar ({sellSymbol && sellSymbol.toUpperCase().endsWith('.IS') ? 'TRY' : 'USD'})</label>
                        <input type="number" placeholder="0.00" value={sellAmount} onChange={e => setSellAmount(e.target.value)} />
                      </div>
                    )}
                    <div className="pf-labeled-input">
                      <label>Birim Fiyat ({sellSymbol && sellSymbol.toUpperCase().endsWith('.IS') ? 'TRY' : 'USD'})</label>
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
