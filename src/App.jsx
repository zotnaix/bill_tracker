import { useEffect, useState } from 'react'
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

const formatPaidDate = () =>
  new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date())

function App() {
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

  const isDark = theme === 'dark'

  const [mp1PrepayMonths, setMp1PrepayMonths] = useState(7) // default Jun->Dec
  const [showPrepayModal, setShowPrepayModal] = useState(false)
  const [prepayPreview, setPrepayPreview] = useState({ months: mp1PrepayMonths, total: mp1PrepayMonths * 200 })

  const toggleRecurringBill = (id) => {
    setRecurringBills((currentBills) =>
      currentBills.map((bill) =>
        bill.id === id
          ? {
              ...bill,
              paid: !bill.paid,
              paidDate: !bill.paid ? formatPaidDate() : '',
            }
          : bill,
      ),
    )
  }

  const toggleSavingsBill = (id) => {
    setSavingsBills((currentBills) =>
      currentBills.map((bill) =>
        bill.id === id
          ? {
              ...bill,
              paid: !bill.paid,
              paidDate: !bill.paid ? formatPaidDate() : '',
            }
          : bill,
      ),
    )
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
  }

  return (
    <>
      <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="Bill Tracker">
          <span className="brand-mark">BT</span>
        </div>

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
      </header>

      <main className="content">
        <section className="hero-card">
          <div className="eyebrow">Minimal bill tracker</div>
          <h1>Track what matters.</h1>
          <p>Mark bills paid, capture the date, and keep savings contributions separate.</p>

          <div className="stats">
            <div>
              <span>Recurring</span>
              <strong>{recurringBills.filter((bill) => bill.paid).length}/3</strong>
            </div>
            <div>
              <span>Savings</span>
              <strong>{savingsBills.filter((bill) => bill.paid).length}/2</strong>
            </div>
            <div>
              <span>Today</span>
              <strong>{new Date().getDate()}</strong>
            </div>
          </div>
        </section>

        <section className="list-card" aria-label="Recurring bills">
          <div className="section-head">
            <h2>Recurring bills</h2>
            <span>No amount</span>
          </div>

          {recurringBills.map((bill) => (
            <div className="bill-row" key={bill.id}>
              <div className="bill-meta">
                <strong>{bill.name}</strong>
                <span>Due every {bill.dueDay}</span>
                {bill.paidDate ? <span>Paid on {bill.paidDate}</span> : null}
              </div>

              <button
                type="button"
                className={`status-toggle ${bill.paid ? 'is-paid' : ''}`}
                onClick={() => toggleRecurringBill(bill.id)}
              >
                {bill.paid ? 'Paid' : 'Unpaid'}
              </button>
            </div>
          ))}
        </section>

        <section className="list-card" aria-label="Savings contributions">
          <div className="section-head">
            <h2>With amount</h2>
            <span>Pag-ibig</span>
          </div>

          {savingsBills.map((bill) => (
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
                {bill.paidDate ? <span>Paid on {bill.paidDate}</span> : null}
                {bill.prepaid ? <span>Covered until {bill.prepaidUntil}</span> : null}
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {bill.id === 'pagibig-mp1' ? (
                  <>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={mp1PrepayMonths}
                        onChange={(e) => setMp1PrepayMonths(Number(e.target.value))}
                        style={{ width: 80, padding: '6px 8px', borderRadius: 8 }}
                        aria-label="MP1 months to prepay"
                      />
                      <button
                        type="button"
                        className="status-toggle"
                        onClick={() => openPrepayModal(mp1PrepayMonths)}
                      >
                        Prepay ₱{mp1PrepayMonths * 200}
                      </button>
                      <button type="button" className="status-toggle" onClick={setMP1Monthly}>
                        Set monthly ₱200
                      </button>
                    </div>
                  </>
                ) : null}

                <button
                  type="button"
                  className={`status-toggle ${bill.paid ? 'is-paid' : ''}`}
                  onClick={() => toggleSavingsBill(bill.id)}
                >
                  {bill.paid ? 'Paid' : 'Unpaid'}
                </button>
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
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
