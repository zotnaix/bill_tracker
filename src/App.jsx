import { useEffect, useRef, useState } from 'react'
import './App.css'

const recurringDefault = [
  { id: 'globe-home', name: 'Globe at Home', dueDay: '5th', paid: false, paidDate: '' },
  { id: 'primewater', name: 'Primewater', dueDay: '15th', paid: false, paidDate: '' },
  { id: 'hoa-dues', name: 'HOA dues', dueDay: '15th', paid: false, paidDate: '' },
]

const savingsDefault = [
  { id: 'pagibig-mp1', name: 'Pag-ibig MP1', amount: '1,000', paid: false, paidDate: '' },
  { id: 'pagibig-mp2', name: 'Pag-ibig MP2', amount: '1,000', paid: false, paidDate: '' },
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
  if (title.startsWith('Pag-ibig')) {
    return title.split(' ').at(-1) ?? title
  }

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

function App() {
  const [view, setView] = useState('dashboard')
  const receiptInputRef = useRef(null)
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') {
      return 'light'
    }

    return window.localStorage.getItem('bill-tracker-theme') ?? 'light'
  })

  const [recurringBills, setRecurringBills] = useState(() => {
    if (typeof window === 'undefined') {
      return recurringDefault
    }

    const storedBills = window.localStorage.getItem('bill-tracker-recurring')

    return storedBills ? JSON.parse(storedBills) : recurringDefault
  })

  const [savingsBills, setSavingsBills] = useState(() => {
    if (typeof window === 'undefined') {
      return savingsDefault
    }

    const storedBills = window.localStorage.getItem('bill-tracker-savings')

    if (!storedBills) return savingsDefault

    try {
      const parsed = JSON.parse(storedBills)
      const now = Date.now()
      return parsed.map((b) => {
        if (b.prepaidExpiry) {
          const expiry = new Date(b.prepaidExpiry).getTime()
          if (expiry <= now) {
            // expired -> clear prepaid state
            return {
              ...b,
              prepaid: false,
              paid: false,
              paidDate: '',
              prepaidExpiry: undefined,
              prepaidMonths: 0,
              prepaidUntil: '',
            }
          }
        }

        return b
      })
    } catch (e) {
      return savingsDefault
    }
  })

  const [paymentHistory, setPaymentHistory] = useState(() => {
    if (typeof window === 'undefined') {
      return []
    }

    const storedHistory = window.localStorage.getItem('bill-tracker-history')

    if (!storedHistory) return []

    try {
      return dedupeHistoryEntries(JSON.parse(storedHistory))
    } catch (error) {
      return []
    }
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('bill-tracker-theme', theme)
  }, [theme])

  useEffect(() => {
    window.localStorage.setItem('bill-tracker-recurring', JSON.stringify(recurringBills))
  }, [recurringBills])

  useEffect(() => {
    window.localStorage.setItem('bill-tracker-savings', JSON.stringify(savingsBills))
  }, [savingsBills])

  useEffect(() => {
    window.localStorage.setItem('bill-tracker-history', JSON.stringify(paymentHistory))
  }, [paymentHistory])

  const isDark = theme === 'dark'
  const currentDateLabel = new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date())

  const [mp1PrepayMonths, setMp1PrepayMonths] = useState(7) // default Jun->Dec
  const [showPrepayModal, setShowPrepayModal] = useState(false)
  const [prepayPreview, setPrepayPreview] = useState({ months: mp1PrepayMonths, total: mp1PrepayMonths * 200 })
  const [pendingReceiptTarget, setPendingReceiptTarget] = useState(null)
  const [receiptPreview, setReceiptPreview] = useState(null)

  const upsertHistory = (entry) => {
    const monthKey = getMonthKey()

    setPaymentHistory((currentHistory) => {
      const nextHistory = currentHistory.filter((item) => item.uniqueKey !== entry.uniqueKey)

      return [
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
    })
  }

  const removeHistory = (uniqueKey) => {
    setPaymentHistory((currentHistory) =>
      currentHistory.filter((item) => item.uniqueKey !== uniqueKey),
    )
  }

  const openReceiptPicker = (section, id) => {
    setPendingReceiptTarget({ section, id })
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
      setRecurringBills((currentBills) =>
        currentBills.map((bill) => (bill.id === id ? { ...bill, ...updatedReceipt } : bill)),
      )

      return recurringBills.find((bill) => bill.id === id)
    }

    if (section === 'savings') {
      setSavingsBills((currentBills) =>
        currentBills.map((bill) => (bill.id === id ? { ...bill, ...updatedReceipt } : bill)),
      )

      return savingsBills.find((bill) => bill.id === id)
    }

    return null
  }

  const clearBillReceipt = (section, id) => {
    const uniqueKey = `${id}-${getMonthKey()}`

    if (section === 'recurring') {
      setRecurringBills((currentBills) =>
        currentBills.map((bill) =>
          bill.id === id
            ? { ...bill, paid: false, paidDate: '', receiptDataUrl: '', receiptName: '' }
            : bill,
        ),
      )
    }

    if (section === 'savings') {
      setSavingsBills((currentBills) =>
        currentBills.map((bill) =>
          bill.id === id
            ? { ...bill, paid: false, paidDate: '', receiptDataUrl: '', receiptName: '' }
            : bill,
        ),
      )
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
        type: target.section === 'recurring' ? 'Recurring' : 'Savings',
        amount: target.section === 'recurring' ? 'N/A' : bill.amount,
        months: '1 month',
        note:
          target.section === 'recurring'
            ? `Due every ${bill.dueDay}`
            : bill.id === 'pagibig-mp1'
              ? 'Monthly contribution'
              : 'Monthly contribution',
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

    setRecurringBills((currentBills) =>
      currentBills.map((item) =>
        item.id === id
          ? {
              ...item,
              paid: willBePaid,
              paidDate: willBePaid ? formatPaidDate() : '',
            }
          : item,
      ),
    )

    if (!willBePaid) {
      clearBillReceipt('recurring', bill.id)
    }
  }

  const toggleSavingsBill = (id) => {
    const bill = savingsBills.find((item) => item.id === id)
    if (!bill) return

    const uniqueKey = `${bill.id}-${getMonthKey()}`
    const willBePaid = !bill.paid

    setSavingsBills((currentBills) =>
      currentBills.map((item) =>
        item.id === id
          ? {
              ...item,
              paid: willBePaid,
              paidDate: willBePaid ? formatPaidDate() : '',
            }
          : item,
      ),
    )

    if (!willBePaid) {
      clearBillReceipt('savings', bill.id)
    }
  }

  const updateSavingsAmount = (id, value) => {
    setSavingsBills((currentBills) =>
      currentBills.map((bill) => (bill.id === id ? { ...bill, amount: value } : bill)),
    )
  }

  const prepayMP1 = (months = mp1PrepayMonths) => {
    const perMonth = 200
    const total = months * perMonth
    const expiry = new Date()
    expiry.setMonth(expiry.getMonth() + months)

    setSavingsBills((currentBills) =>
      currentBills.map((bill) =>
        bill.id === 'pagibig-mp1'
          ? {
              ...bill,
              paid: true,
              paidDate: formatPaidDate(),
              prepaid: true,
              prepaidMonths: months,
              prepaidUntil: `+${months} mo`,
              prepaidExpiry: expiry.toISOString(),
              amount: String(total),
            }
          : bill,
      ),
    )

    upsertHistory({
      uniqueKey: `pagibig-mp1-${getMonthKey()}`,
      title: 'Pag-ibig MP1',
      type: 'Savings',
      amount: String(total),
      months: '1 month',
      note: 'Monthly contribution',
    })
  }

  // On mount, double-check for expiry in case time passed while app was closed.
  useEffect(() => {
    setSavingsBills((current) => {
      const now = Date.now()
      return current.map((b) => {
        if (b.prepaidExpiry) {
          const expiry = new Date(b.prepaidExpiry).getTime()
          if (expiry <= now) {
            return {
              ...b,
              prepaid: false,
              paid: false,
              paidDate: '',
              prepaidExpiry: undefined,
              prepaidMonths: 0,
              prepaidUntil: '',
            }
          }
        }
        return b
      })
    })
  }, [])

  const openPrepayModal = (months) => {
    const monthsToPreview = months ?? mp1PrepayMonths
    setPrepayPreview({ months: monthsToPreview, total: monthsToPreview * 200 })
    setShowPrepayModal(true)
  }

  const confirmPrepay = () => {
    prepayMP1(prepayPreview.months)
    setShowPrepayModal(false)
  }

  const cancelPrepay = () => {
    setShowPrepayModal(false)
  }

  const setMP1Monthly = () => {
    setSavingsBills((currentBills) =>
      currentBills.map((bill) =>
        bill.id === 'pagibig-mp1'
          ? { ...bill, paid: false, paidDate: '', prepaid: false, amount: '200' }
          : bill,
      ),
    )

    clearBillReceipt('savings', 'pagibig-mp1')
  }

  const dashboardBills = recurringBills.length + savingsBills.length
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
      if (entry.amount && entry.amount !== 'N/A') {
        return accumulator
      }

      if (!accumulator.some((item) => item.title === entry.title)) {
        accumulator.push(entry)
      }

      return accumulator
    }, [])

    const pagibigContributions = monthEntries.reduce((accumulator, entry) => {
      if (!entry.amount || entry.amount === 'N/A') {
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
      pagibigContributions,
    }
  })

  return (
    <>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand" aria-label="Bill Tracker">
            <div className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <rect x="4" y="5" width="16" height="14" rx="4" />
                <path d="M8 8.5h4.2a2 2 0 0 1 0 4H8Z" />
                <path d="M8 12.5h5.2a2 2 0 0 1 0 4H8Z" />
              </svg>
            </div>
          </div>

          <div className="toolbar">
            <button
              type="button"
              className={`nav-pill ${view === 'dashboard' ? 'is-active' : ''}`}
              onClick={() => setView('dashboard')}
            >
              Dashboard
            </button>
            <button
              type="button"
              className={`nav-pill ${view === 'history' ? 'is-active' : ''}`}
              onClick={() => setView('history')}
            >
              History
            </button>

            <span className="date-pill" aria-label={`Current date ${currentDateLabel}`}>
              {currentDateLabel}
            </span>

            <button
              type="button"
              className="theme-toggle"
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
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
        </header>

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
                        <button
                          type="button"
                          className="status-toggle"
                          onClick={() => openReceiptPicker('recurring', bill.id)}
                        >
                          Upload receipt
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </section>

            <section className="list-card" aria-label="Savings contributions">
              <div className="section-head">
                <h2>Pag-Ibig contributions</h2>
              </div>

              {savingsBills.map((bill) => {
                const isPaid = Boolean(bill.paid || bill.receiptDataUrl)

                return (
                  <div className="bill-row" key={bill.id}>
                    <div className="bill-meta">
                      <strong>{bill.name}</strong>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                          Amount:
                        </label>
                        <input
                          aria-label={`${bill.name} amount`}
                          value={bill.amount}
                          onChange={(e) => updateSavingsAmount(bill.id, e.target.value)}
                          style={{ width: 96, padding: '6px 8px', borderRadius: 8 }}
                        />
                      </div>
                      <span className={`due-badge ${isPaid ? 'is-paid' : 'blue'}`}>
                        {isPaid ? 'Paid' : 'Monthly'}
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
                            onClick={() => clearBillReceipt('savings', bill.id)}
                          >
                            Undo
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="status-toggle"
                          onClick={() => openReceiptPicker('savings', bill.id)}
                        >
                          Upload receipt
                        </button>
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

              <div className="history-table">
                <div className="history-table-head">
                  <div>Month</div>
                  <div>Monthly bills</div>
                  <div>Pag-Ibig contributions</div>
                </div>

                {historyByMonth.map((month) => (
                  <div className="history-table-row" key={month.monthLabel}>
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

                    <div className="history-cell history-grid history-grid-pagibig">
                      {month.pagibigContributions.length ? (
                        month.pagibigContributions.map((entry) => (
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

      {receiptPreview ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal receipt-modal">
            <div className="section-head">
              <h2>{receiptPreview.title}</h2>
              <button
                type="button"
                className="undo-toggle"
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

      {showPrepayModal ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>Confirm prepay</h3>
            <p>
              Prepay <strong>₱{prepayPreview.total}</strong> to cover{' '}
              <strong>{prepayPreview.months} month(s)</strong> of MP1? This will mark
              MP1 as paid and record today's date.
            </p>
            <div className="modal-actions">
              <button className="status-toggle" onClick={confirmPrepay}>
                Confirm
              </button>
              <button className="status-toggle" onClick={cancelPrepay}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export default App
