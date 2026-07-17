import { useEffect, useRef, useState } from 'react'
import './App.css'
import { loadAppSnapshot, saveAppSnapshot, getDatabaseInfo } from './lib/billStore'

const recurringDefault = [
  { id: 'globe-home', name: 'Globe at Home', dueDay: '5th', paid: false, paidDate: '' },
  { id: 'primewater', name: 'Primewater', dueDay: '17th', paid: false, paidDate: '' },
  { id: 'hoa-dues', name: 'HOA dues', dueDay: '17th', paid: false, paidDate: '' },
]

const billersDefault = [
  { id: 'sample-biller-1', name: 'Sample biller', dueDay: '10th', paid: false, paidDate: '' },
  { id: 'sample-biller-2', name: 'Another biller', dueDay: '20th', paid: false, paidDate: '' },
]

const monthLabels = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const formatPaidDate = () =>
  new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date())

const getMonthKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

const getHistoryButtonLabel = (title) => {
  if (title.includes('Globe')) {
    return 'Globe'
  }

  return title.split(' ')[0] ?? title
}

const dedupeHistoryEntries = (entries) => {
  const seen = new Set()

  return entries.filter((entry) => {
    const entryDate = entry.timestamp ? new Date(entry.timestamp) : new Date(entry.date)
    const monthKey = entry.monthKey ?? getMonthKey(entryDate)
    const dedupeKey = entry.uniqueKey ?? `${monthKey}-${entry.title}-${entry.type}`

    if (seen.has(dedupeKey)) {
      return false
    }

    seen.add(dedupeKey)
    return true
  })
}

const parseDueDay = (dueDay) => {
  const numeric = Number(dueDay.replace(/\D/g, ''))
  return Number.isNaN(numeric) ? 1 : numeric
}

const getDueInfo = (dueDay) => {
  const today = new Date()
  const currentYear = today.getFullYear()
  const currentMonth = today.getMonth()
  const dueDateNumber = parseDueDay(dueDay)

  const dueThisMonth = new Date(currentYear, currentMonth, dueDateNumber)
  const millisPerDay = 1000 * 60 * 60 * 24
  const diffDays = Math.ceil((dueThisMonth.setHours(23, 59, 59, 999) - today.getTime()) / millisPerDay)

  if (diffDays < 0) {
    return { label: `${Math.abs(diffDays)} day(s) overdue`, tone: 'overdue' }
  }

  if (diffDays === 0) {
    return { label: 'Due today', tone: 'critical' }
  }

  if (diffDays <= 2) {
    return { label: `${diffDays} day(s) left`, tone: 'critical' }
  }

  if (diffDays <= 5) {
    return { label: `${diffDays} day(s) left`, tone: 'orange' }
  }

  if (diffDays <= 10) {
    return { label: `${diffDays} day(s) left`, tone: 'yellow' }
  }

  return { label: `${diffDays} day(s) left`, tone: 'blue' }
}

const normalizeSavingsBill = (bill) => {
  if (!bill || typeof bill !== 'object') {
    return null
  }

  if (!bill.prepaidExpiry) {
    return bill
  }

  const expiry = new Date(bill.prepaidExpiry).getTime()

  if (Number.isNaN(expiry) || expiry > Date.now()) {
    return bill
  }

  return {
    ...bill,
    prepaid: false,
    paid: false,
    paidDate: '',
    prepaidExpiry: undefined,
    prepaidMonths: 0,
    prepaidUntil: '',
  }
}

const normalizeSavingsBills = (bills) => bills.map((bill) => normalizeSavingsBill(bill) ?? bill)

const normalizeBillers = (billers) =>
  billers.map((biller) => ({
    ...biller,
    dueDay: biller.dueDay ?? '1st',
  }))

const resetRecurringBillsForNewMonth = (bills) =>
  bills.map((bill) => ({
    ...bill,
    paid: false,
    paidDate: '',
    receiptDataUrl: '',
    receiptName: '',
  }))

const getInitialAppState = () => ({
  theme: 'light',
  recurringBills: recurringDefault,
  billers: billersDefault,
  paymentHistory: [],
  billingCycleMonthKey: getMonthKey(),
})

const THEME_STORAGE_KEY = 'bill-tracker-theme'

function App() {
  const [view, setView] = useState('dashboard')
  const [historyTab, setHistoryTab] = useState('monthly')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const receiptInputRef = useRef(null)
  const receiptCameraInputRef = useRef(null)
  const [theme, setTheme] = useState('light')
  const [recurringBills, setRecurringBills] = useState(recurringDefault)
  const [billers, setBillers] = useState(billersDefault)
  const [paymentHistory, setPaymentHistory] = useState([])
  const [billingCycleMonthKey, setBillingCycleMonthKey] = useState(getMonthKey())
  const [isHydrated, setIsHydrated] = useState(false)
  const [isBillerModalOpen, setIsBillerModalOpen] = useState(false)
  const [billerEditorMode, setBillerEditorMode] = useState('add')
  const [editingBillerId, setEditingBillerId] = useState(null)
  const [billerName, setBillerName] = useState('')
  const [billerDueDay, setBillerDueDay] = useState('')

  const persistAppState = (nextState) => {
    void saveAppSnapshot({
      theme: nextState.theme,
      recurringBills: nextState.recurringBills,
      billers: nextState.billers,
      paymentHistory: nextState.paymentHistory,
      billingCycleMonthKey: nextState.billingCycleMonthKey,
    })

    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextState.theme)
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    let cancelled = false

    const hydrate = async () => {
      try {
        const snapshot = await loadAppSnapshot(getInitialAppState())

        if (cancelled) {
          return
        }

        const storedTheme = typeof window !== 'undefined' && window.localStorage
          ? window.localStorage.getItem(THEME_STORAGE_KEY)
          : null

        const nextTheme = storedTheme ?? snapshot.theme ?? 'light'

        setTheme(nextTheme)
        const savedBillingCycleMonthKey = snapshot.billingCycleMonthKey ?? getMonthKey()
        const currentMonthKey = getMonthKey()
        const shouldResetRecurringBills = savedBillingCycleMonthKey !== currentMonthKey

        setBillingCycleMonthKey(currentMonthKey)
        setRecurringBills(
          shouldResetRecurringBills
            ? resetRecurringBillsForNewMonth(snapshot.recurringBills ?? recurringDefault)
            : snapshot.recurringBills ?? recurringDefault,
        )
        setBillers(normalizeBillers(snapshot.billers ?? billersDefault))
        setPaymentHistory(dedupeHistoryEntries(snapshot.paymentHistory ?? []))
      } finally {
        if (!cancelled) {
          setIsHydrated(true)
        }
      }
    }

    void hydrate()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isHydrated) {
      return
    }

    persistAppState({
      theme,
      recurringBills,
      billers,
      paymentHistory,
      billingCycleMonthKey,
    })
  }, [billingCycleMonthKey, billers, isHydrated, paymentHistory, recurringBills, theme])

  useEffect(() => {
    if (!isHydrated) {
      return
    }

    const flushSnapshot = () => {
      persistAppState({
        theme,
        recurringBills,
        billers,
        paymentHistory,
        billingCycleMonthKey,
      })
    }

    window.addEventListener('pagehide', flushSnapshot)
    window.addEventListener('beforeunload', flushSnapshot)

    return () => {
      window.removeEventListener('pagehide', flushSnapshot)
      window.removeEventListener('beforeunload', flushSnapshot)
    }
  }, [billingCycleMonthKey, billers, isHydrated, paymentHistory, recurringBills, theme])

  const handleThemeToggle = () => {
    const nextTheme = isDark ? 'light' : 'dark'

    setTheme(nextTheme)
    persistAppState({
      theme: nextTheme,
      recurringBills,
      billers,
      paymentHistory,
      billingCycleMonthKey,
    })
  }

  const switchView = (nextView) => {
    setView(nextView)
    setMobileMenuOpen(false)
  }

  useEffect(() => {
    if (!isHydrated) {
      return
    }

    const checkBillingCycle = () => {
      const currentMonthKey = getMonthKey()

      setBillingCycleMonthKey((savedMonthKey) => {
        if (savedMonthKey === currentMonthKey) {
          return savedMonthKey
        }

        setRecurringBills((currentBills) => resetRecurringBillsForNewMonth(currentBills))
        return currentMonthKey
      })
    }

    checkBillingCycle()
    const intervalId = window.setInterval(checkBillingCycle, 60 * 1000)

    return () => window.clearInterval(intervalId)
  }, [isHydrated])

  const isDark = theme === 'dark'
  const currentDateLabel = new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date())

  const [pendingReceiptTarget, setPendingReceiptTarget] = useState(null)
  const [receiptPreview, setReceiptPreview] = useState(null)

  const upsertHistory = (entry) => {
    const monthKey = getMonthKey()

    setPaymentHistory((currentHistory) => {
      const nextHistory = currentHistory.filter((item) => item.uniqueKey !== entry.uniqueKey)

      const nextHistoryState = [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          uniqueKey: entry.uniqueKey,
          monthKey,
          date: formatPaidDate(),
          timestamp: new Date().toISOString(),
          ...entry,
        },
        ...nextHistory,
      ]

      persistAppState({
        theme,
        recurringBills,
        billers,
        paymentHistory: nextHistoryState,
        billingCycleMonthKey,
      })

      return nextHistoryState
    })
  }

  const removeHistory = (uniqueKey) => {
    setPaymentHistory((currentHistory) =>
      currentHistory.filter((item) => item.uniqueKey !== uniqueKey),
    )
  }

  const openReceiptPicker = (section, id, mode = 'gallery') => {
    setPendingReceiptTarget({ section, id })

    if (mode === 'camera') {
      if (receiptCameraInputRef.current) {
        receiptCameraInputRef.current.value = ''
        receiptCameraInputRef.current.click()
      }
      return
    }

    if (receiptInputRef.current) {
      receiptInputRef.current.value = ''
      receiptInputRef.current.click()
    }
  }

  const updateBillWithReceipt = (section, id, receiptDataUrl, receiptName) => {
    const updatedReceipt = {
      paid: true,
      paidDate: formatPaidDate(),
      receiptDataUrl,
      receiptName,
    }

    if (section === 'recurring') {
      const nextRecurringBills = recurringBills.map((bill) =>
        bill.id === id ? { ...bill, ...updatedReceipt } : bill,
      )
      setRecurringBills(nextRecurringBills)
      persistAppState({
        theme,
        recurringBills: nextRecurringBills,
        billers,
        paymentHistory,
        billingCycleMonthKey,
      })

      return nextRecurringBills.find((bill) => bill.id === id)
    }

    if (section === 'billers') {
      const nextBillers = billers.map((bill) =>
        bill.id === id ? { ...bill, ...updatedReceipt } : bill,
      )
      setBillers(nextBillers)
      persistAppState({
        theme,
        recurringBills,
        billers: nextBillers,
        paymentHistory,
        billingCycleMonthKey,
      })

      return nextBillers.find((bill) => bill.id === id)
    }

    return null
  }

  const clearBillReceipt = (section, id) => {
    const uniqueKey = `${id}-${getMonthKey()}`

    if (section === 'recurring') {
      const nextRecurringBills = recurringBills.map((bill) =>
        bill.id === id
          ? { ...bill, paid: false, paidDate: '', receiptDataUrl: '', receiptName: '' }
          : bill,
      )
      setRecurringBills(nextRecurringBills)
      persistAppState({
        theme,
        recurringBills: nextRecurringBills,
        billers,
        paymentHistory,
        billingCycleMonthKey,
      })
    }

    if (section === 'billers') {
      const nextBillers = billers.map((bill) =>
        bill.id === id
          ? { ...bill, paid: false, paidDate: '', receiptDataUrl: '', receiptName: '' }
          : bill,
      )
      setBillers(nextBillers)
      persistAppState({
        theme,
        recurringBills,
        billers: nextBillers,
        paymentHistory,
        billingCycleMonthKey,
      })
    }

    removeHistory(uniqueKey)
  }

  const handleReceiptUpload = (event) => {
    const file = event.target.files?.[0]
    const target = pendingReceiptTarget

    if (!file || !target) {
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const receiptDataUrl = String(reader.result ?? '')
      const bill = updateBillWithReceipt(target.section, target.id, receiptDataUrl, file.name)

      if (!bill) {
        return
      }

      const uniqueKey = `${bill.id}-${getMonthKey()}`
      upsertHistory({
        uniqueKey,
        title: bill.name,
        type: target.section === 'recurring' ? 'Recurring' : 'Biller',
        amount: 'N/A',
        months: '1 month',
        note: target.section === 'recurring' ? `Due every ${bill.dueDay}` : `Due every ${bill.dueDay}`,
        receiptDataUrl,
        receiptName: file.name,
      })

      setPendingReceiptTarget(null)
    }

    reader.readAsDataURL(file)
  }

  const toggleRecurringBill = (id) => {
    const bill = recurringBills.find((item) => item.id === id)
    if (!bill) return

    const uniqueKey = `${bill.id}-${getMonthKey()}`
    const willBePaid = !bill.paid
    const nextRecurringBills = recurringBills.map((item) =>
      item.id === id
        ? {
            ...item,
            paid: willBePaid,
            paidDate: willBePaid ? formatPaidDate() : '',
          }
        : item,
    )

    setRecurringBills(nextRecurringBills)
    persistAppState({
      theme,
      recurringBills: nextRecurringBills,
      billers,
      paymentHistory,
      billingCycleMonthKey,
    })

    if (!willBePaid) {
      clearBillReceipt('recurring', bill.id)
    }
  }

  const toggleBiller = (id) => {
    const bill = billers.find((item) => item.id === id)
    if (!bill) return

    const uniqueKey = `${bill.id}-${getMonthKey()}`
    const willBePaid = !bill.paid
    const nextBillers = billers.map((item) =>
      item.id === id
        ? {
            ...item,
            paid: willBePaid,
            paidDate: willBePaid ? formatPaidDate() : '',
          }
        : item,
    )

    setBillers(nextBillers)
    persistAppState({
      theme,
      recurringBills,
      billers: nextBillers,
      paymentHistory,
      billingCycleMonthKey,
    })

    if (!willBePaid) {
      clearBillReceipt('billers', bill.id)
    }
  }

  const openAddBillerModal = () => {
    setBillerEditorMode('add')
    setEditingBillerId(null)
    setBillerName('')
    setBillerDueDay('')
    setIsBillerModalOpen(true)
  }

  const openEditBillerModal = (bill) => {
    setBillerEditorMode('edit')
    setEditingBillerId(bill.id)
    setBillerName(bill.name ?? '')
    setBillerDueDay(bill.dueDay ?? '')
    setIsBillerModalOpen(true)
  }

  const closeBillerModal = () => {
    setIsBillerModalOpen(false)
    setEditingBillerId(null)
    setBillerName('')
    setBillerDueDay('')
  }

  const saveBiller = () => {
    const name = billerName.trim()
    const dueDay = billerDueDay.trim()

    if (!name || !dueDay) {
      return
    }

    const nextBillers =
      billerEditorMode === 'edit'
        ? billers.map((bill) =>
            bill.id === editingBillerId
              ? {
                  ...bill,
                  name,
                  dueDay,
                }
              : bill,
          )
        : [
            ...billers,
            {
              id: `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
              name,
              dueDay,
              paid: false,
              paidDate: '',
            },
          ]

    setBillers(nextBillers)
    persistAppState({
      theme,
      recurringBills,
      billers: nextBillers,
      paymentHistory,
      billingCycleMonthKey,
    })
    closeBillerModal()
  }

  const deleteBiller = (id) => {
    const nextBillers = billers.filter((bill) => bill.id !== id)
    setBillers(nextBillers)
    persistAppState({
      theme,
      recurringBills,
      billers: nextBillers,
      paymentHistory,
      billingCycleMonthKey,
    })
  }

  const handleBillerModalSubmit = (event) => {
    event.preventDefault()
    saveBiller()
  }

  const dashboardBills = recurringBills.length + billers.length
  const historyEntries = [...paymentHistory].sort((a, b) => {
    const first = new Date(a.timestamp ?? `${a.date} 00:00:00`).getTime()
    const second = new Date(b.timestamp ?? `${b.date} 00:00:00`).getTime()
    return second - first
  })
  const historyByMonth = monthLabels.map((monthLabel, index) => {
    const monthEntries = historyEntries.filter((entry) => {
      const entryDate = entry.timestamp ? new Date(entry.timestamp) : new Date(entry.date)
      return entryDate.getMonth() === index
    })

    const monthlyBills = monthEntries.reduce((accumulator, entry) => {
      if (entry.type !== 'Recurring') {
        return accumulator
      }

      if (!accumulator.some((item) => item.title === entry.title)) {
        accumulator.push(entry)
      }

      return accumulator
    }, [])

    const billerEntries = monthEntries.reduce((accumulator, entry) => {
      if (entry.type !== 'Biller') {
        return accumulator
      }

      if (!accumulator.some((item) => item.title === entry.title)) {
        accumulator.push(entry)
      }

      return accumulator
    }, [])

    return {
      monthLabel,
      monthlyBills,
      billerEntries,
    }
  })

  return (
    <>
      <div className="app-shell">
        <header className="topbar">
          <div className="topbar-left">
            <div className="brand" aria-label="Bills">
              <div className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3.5" y="4" width="17" height="16" rx="4" />
                  <path d="M7 8h9M7 11h7M7 14h5" />
                  <circle cx="16.5" cy="13" r="2.25" />
                  <path d="M16.5 11.8v2.4M15.45 12.55h2.1" />
                </svg>
              </div>
            </div>

            <button
              type="button"
              className={`menu-toggle ${mobileMenuOpen ? 'is-open' : ''}`}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((current) => !current)}
            >
              <span />
              <span />
              <span />
            </button>

            <button
              type="button"
              className="theme-toggle"
              onClick={handleThemeToggle}
              aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
            >
              {isDark ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3a1 1 0 0 1 1 1v1.1a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1Zm0 14.9a1 1 0 0 1 1 1V20a1 1 0 1 1-2 0v-1.1a1 1 0 0 1 1-1Zm8-5.9a1 1 0 1 1 0 2h-1.1a1 1 0 1 1 0-2H20Zm-14.9 0a1 1 0 1 1 0 2H4a1 1 0 1 1 0-2h1.1Zm11.3-6.2a1 1 0 0 1 1.4 1.4l-.8.8a1 1 0 1 1-1.4-1.4l.8-.8Zm-10 10a1 1 0 0 1 1.4 1.4l-.8.8a1 1 0 1 1-1.4-1.4l.8-.8Zm10 1.4a1 1 0 0 1 0-1.4 1 1 0 0 1 1.4 0l.8.8a1 1 0 0 1-1.4 1.4l-.8-.8Zm-10-10a1 1 0 0 1 0-1.4 1 1 0 0 1 1.4 0l.8.8A1 1 0 1 1 9.8 8l-.8-.8Zm8.7 4.8a5.8 5.8 0 1 1-11.6 0 5.8 5.8 0 0 1 11.6 0Z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M21 14.1A8.7 8.7 0 0 1 9.9 3a1 1 0 0 0-1.2 1.2 7.7 7.7 0 1 0 10.1 10.1 1 1 0 0 0 1.2-1.2Z" />
                </svg>
              )}
            </button>
          </div>

          <div className="toolbar">
            <button
              type="button"
              className={`nav-pill ${view === 'dashboard' ? 'is-active' : ''}`}
              onClick={() => switchView('dashboard')}
            >
              Dashboard
            </button>
            <button
              type="button"
              className={`nav-pill ${view === 'history' ? 'is-active' : ''}`}
              onClick={() => switchView('history')}
            >
              History
            </button>

            <span className="date-pill" aria-label={`Current date ${currentDateLabel}`}>
              {currentDateLabel}
            </span>

            {/* Debug DB buttons removed for production; keep store APIs available for tests */}
            {import.meta.env.DEV ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 12 }}>
                <button
                  type="button"
                  className="nav-pill"
                  onClick={async () => {
                    try {
                      const m = await import('./lib/billStore')
                      const blob = await m.exportDatabaseFile()

                      if (!blob) {
                        window.alert('Native DB export not available from the web UI. Use Device File Explorer or adb to pull the DB.')
                        return
                      }

                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url
                      a.download = 'bill-tracker.sqlite'
                      document.body.appendChild(a)
                      a.click()
                      a.remove()
                      URL.revokeObjectURL(url)
                    } catch (err) {
                      window.alert(String(err))
                    }
                  }}
                >
                  Export DB
                </button>

                <button
                  type="button"
                  className="nav-pill"
                  onClick={async () => {
                    if (!window.confirm('Clear the app database and reset to a clean slate? This cannot be undone.')) return

                    try {
                      await import('./lib/billStore').then(m => m.clearAppDatabase())
                      window.location.reload()
                    } catch (err) {
                      window.alert(String(err))
                    }
                  }}
                >
                  Clear DB (dev)
                </button>
              </div>
            ) : null}
          </div>
        </header>

        {mobileMenuOpen ? (
          <nav className="mobile-nav" aria-label="Mobile navigation">
            <button
              type="button"
              className={`nav-pill ${view === 'dashboard' ? 'is-active' : ''}`}
              onClick={() => switchView('dashboard')}
            >
              Dashboard
            </button>
            <button
              type="button"
              className={`nav-pill ${view === 'history' ? 'is-active' : ''}`}
              onClick={() => switchView('history')}
            >
              History
            </button>
          </nav>
        ) : null}

        {view === 'dashboard' ? (
          <main className="content">
            <section className="list-card" aria-label="Recurring bills">
              <div className="section-head">
                <h2>Monthly bills</h2>
              </div>

              {recurringBills.map((bill) => {
                const isPaid = Boolean(bill.paid || bill.receiptDataUrl)

                return (
                  <div className="bill-row" key={bill.id}>
                    <div className="bill-meta">
                      <strong>{bill.name}</strong>
                      <span>Due every {bill.dueDay}</span>
                      <span className={`due-badge ${isPaid ? 'is-paid' : getDueInfo(bill.dueDay).tone}`}>
                        {isPaid ? 'Paid' : getDueInfo(bill.dueDay).label}
                      </span>
                    </div>

                    <div className="bill-actions">
                      {bill.receiptDataUrl ? (
                        <>
                          <button
                            type="button"
                            className="status-toggle"
                            onClick={() =>
                              setReceiptPreview({
                                title: bill.name,
                                date: bill.paidDate,
                                receiptDataUrl: bill.receiptDataUrl,
                                receiptName: bill.receiptName,
                              })
                            }
                          >
                            View
                          </button>
                          <button
                            type="button"
                            className="undo-toggle"
                            onClick={() => clearBillReceipt('recurring', bill.id)}
                          >
                            Undo
                          </button>
                        </>
                      ) : (
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            type="button"
                            className="nav-pill"
                            onClick={() => openReceiptPicker('recurring', bill.id, 'camera')}
                          >
                            Camera
                          </button>
                          <button
                            type="button"
                            className="status-toggle"
                            onClick={() => openReceiptPicker('recurring', bill.id, 'gallery')}
                          >
                            Gallery
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </section>

            <section className="list-card" aria-label="Billers">
              <div className="section-head">
                <h2>Billers</h2>
              </div>

              <button type="button" className="nav-pill biller-add-button" onClick={openAddBillerModal}>
                Add biller
              </button>

              {billers.map((bill) => {
                const isPaid = Boolean(bill.paid || bill.receiptDataUrl)

                return (
                  <div className="bill-row" key={bill.id}>
                    <div className="bill-meta">
                      <strong>{bill.name}</strong>
                      <span>Due every {bill.dueDay}</span>
                      <span className={`due-badge ${isPaid ? 'is-paid' : 'blue'}`}>
                        {isPaid ? 'Paid' : 'Monthly'}
                      </span>
                    </div>

                    <div className="bill-actions">
                      <button
                        type="button"
                        className="status-toggle"
                        onClick={() => openEditBillerModal(bill)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="undo-toggle"
                        onClick={() => deleteBiller(bill.id)}
                      >
                        Delete
                      </button>
                      {bill.receiptDataUrl ? (
                        <>
                          <button
                            type="button"
                            className="status-toggle"
                            onClick={() =>
                              setReceiptPreview({
                                title: bill.name,
                                date: bill.paidDate,
                                receiptDataUrl: bill.receiptDataUrl,
                                receiptName: bill.receiptName,
                              })
                            }
                          >
                            View
                          </button>
                          <button
                            type="button"
                            className="undo-toggle"
                            onClick={() => clearBillReceipt('billers', bill.id)}
                          >
                            Undo
                          </button>
                        </>
                      ) : (
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            type="button"
                            className="nav-pill"
                            onClick={() => openReceiptPicker('billers', bill.id, 'camera')}
                          >
                            Camera
                          </button>
                          <button
                            type="button"
                            className="status-toggle"
                            onClick={() => openReceiptPicker('billers', bill.id, 'gallery')}
                          >
                            Gallery
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </section>
          </main>
        ) : (
          <main className="content history-view">
            <section className="history-page-header">
              <div>
                <div className="eyebrow">Payment history</div>
                <h1>Monthly summary.</h1>
              </div>
            </section>

            <section className="list-card history-card" aria-label="History log">
              <div className="section-head">
                <h2>History log</h2>
                <span>{historyEntries.length} entries</span>
              </div>

              <div className="history-tabs" role="tablist" aria-label="History categories">
                <button
                  type="button"
                  role="tab"
                  aria-selected={historyTab === 'monthly'}
                  className={`history-tab ${historyTab === 'monthly' ? 'is-active' : ''}`}
                  onClick={() => setHistoryTab('monthly')}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={historyTab === 'billers'}
                  className={`history-tab ${historyTab === 'billers' ? 'is-active' : ''}`}
                  onClick={() => setHistoryTab('billers')}
                >
                  Billers
                </button>
              </div>

              {historyTab === 'monthly' ? (
                <div className="history-table">
                    <div className="history-table-head history-table-head-single">
                      <div>Month</div>
                      <div>Monthly bills</div>
                    </div>

                  {historyByMonth.map((month) => (
                    <div className="history-table-row history-table-row-single" key={month.monthLabel}>
                      <div className="history-month-label">{month.monthLabel}</div>

                      <div className="history-cell history-grid history-grid-monthly">
                        {month.monthlyBills.length ? (
                          month.monthlyBills.map((entry) => (
                            <button
                              type="button"
                              key={entry.id}
                              className="history-view-button history-bill-button"
                              onClick={() =>
                                setReceiptPreview({
                                  title: entry.title,
                                  receiptDataUrl: entry.receiptDataUrl,
                                  receiptName: entry.receiptName,
                                })
                              }
                            >
                              {getHistoryButtonLabel(entry.title)}
                            </button>
                          ))
                        ) : (
                          <span className="history-empty">—</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="history-table">
                  <div className="history-table-head history-table-head-single">
                    <div>Month</div>
                    <div>Billers</div>
                  </div>

                  {historyByMonth.map((month) => (
                    <div className="history-table-row history-table-row-single" key={month.monthLabel}>
                      <div className="history-month-label">{month.monthLabel}</div>

                      <div className="history-cell history-grid history-grid-billers">
                        {month.billerEntries.length ? (
                          month.billerEntries.map((entry) => (
                            <button
                              type="button"
                              key={entry.id}
                              className="history-view-button history-bill-button"
                              onClick={() =>
                                setReceiptPreview({
                                  title: entry.title,
                                  receiptDataUrl: entry.receiptDataUrl,
                                  receiptName: entry.receiptName,
                                })
                              }
                            >
                              {getHistoryButtonLabel(entry.title)}
                            </button>
                          ))
                        ) : (
                          <span className="history-empty">—</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </main>
        )}
      </div>

      <input
        ref={receiptInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={handleReceiptUpload}
      />
      <input
        ref={receiptCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={handleReceiptUpload}
      />

      {receiptPreview ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal receipt-modal">
            <div className="receipt-modal-head">
              <h2>{receiptPreview.title}</h2>
              <button
                type="button"
                className="receipt-close-button"
                onClick={() => setReceiptPreview(null)}
              >
                Close
              </button>
            </div>
            <img
              className="receipt-image"
              src={receiptPreview.receiptDataUrl}
              alt={receiptPreview.receiptName ?? 'Receipt preview'}
            />
          </div>
        </div>
      ) : null}

      {isBillerModalOpen ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <form className="modal" onSubmit={handleBillerModalSubmit}>
            <h3>{billerEditorMode === 'edit' ? 'Edit biller' : 'Add biller'}</h3>
            <div className="biller-modal-fields">
              <label className="modal-field">
                <span>Name</span>
                <input
                  type="text"
                  value={billerName}
                  onChange={(e) => setBillerName(e.target.value)}
                  placeholder="e.g. Internet"
                  autoFocus
                />
              </label>
              <label className="modal-field">
                <span>Due date</span>
                <input
                  type="text"
                  value={billerDueDay}
                  onChange={(e) => setBillerDueDay(e.target.value)}
                  placeholder="e.g. 15th"
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="status-toggle" onClick={closeBillerModal}>
                Cancel
              </button>
              <button type="submit" className="nav-pill">
                {billerEditorMode === 'edit' ? 'Save changes' : 'Add biller'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}

export default App

