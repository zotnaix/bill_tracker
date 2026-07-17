import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import "../app-legacy.css";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Bill Tracker" },
      { name: "description", content: "Track monthly bills, due dates, and receipts in one place." },
      { property: "og:title", content: "Bill Tracker" },
      { property: "og:description", content: "Track monthly bills, due dates, and receipts in one place." },
    ],
  }),
  component: BillTracker,
});

type Bill = {
  id: string;
  name: string;
  dueDay: string;
  paid: boolean;
  paidDate: string;
  receiptDataUrl?: string;
  receiptName?: string;
};

type HistoryEntry = {
  id: string;
  uniqueKey: string;
  monthKey: string;
  date: string;
  timestamp: string;
  title: string;
  receiptDataUrl?: string;
  receiptName?: string;
};

const defaultBills: Bill[] = [
  { id: "globe-home", name: "Globe at Home", dueDay: "5th", paid: false, paidDate: "" },
  { id: "primewater", name: "Primewater", dueDay: "17th", paid: false, paidDate: "" },
  { id: "hoa-dues", name: "HOA dues", dueDay: "17th", paid: false, paidDate: "" },
];

const monthLabels = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const formatPaidDate = () =>
  new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(new Date());

const getMonthKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const getHistoryButtonLabel = (title: string) => {
  if (title.includes("Globe")) return "Globe";
  return title.split(" ")[0] ?? title;
};

const parseDueDay = (dueDay: string) => {
  const numeric = Number(dueDay.replace(/\D/g, ""));
  return Number.isNaN(numeric) ? 1 : numeric;
};

const getDueInfo = (dueDay: string) => {
  const today = new Date();
  const dueThisMonth = new Date(today.getFullYear(), today.getMonth(), parseDueDay(dueDay));
  const diffDays = Math.ceil(
    (dueThisMonth.setHours(23, 59, 59, 999) - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 0) return { label: `${Math.abs(diffDays)} day(s) overdue`, tone: "overdue" };
  if (diffDays === 0) return { label: "Due today", tone: "critical" };
  if (diffDays <= 2) return { label: `${diffDays} day(s) left`, tone: "critical" };
  if (diffDays <= 5) return { label: `${diffDays} day(s) left`, tone: "orange" };
  if (diffDays <= 10) return { label: `${diffDays} day(s) left`, tone: "yellow" };
  return { label: `${diffDays} day(s) left`, tone: "blue" };
};

const resetBillsForNewMonth = (bills: Bill[]): Bill[] =>
  bills.map((b) => ({ ...b, paid: false, paidDate: "", receiptDataUrl: "", receiptName: "" }));

const STORAGE_KEY = "bill-tracker-state-v1";
const THEME_KEY = "bill-tracker-theme";

type AppSnapshot = {
  bills: Bill[];
  paymentHistory: HistoryEntry[];
  billingCycleMonthKey: string;
};

const loadSnapshot = (): AppSnapshot | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AppSnapshot;
  } catch {
    return null;
  }
};

const saveSnapshot = (snapshot: AppSnapshot) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
};

function BillTracker() {
  const [view, setView] = useState<"dashboard" | "history">("dashboard");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [bills, setBills] = useState<Bill[]>(defaultBills);
  const [paymentHistory, setPaymentHistory] = useState<HistoryEntry[]>([]);
  const [billingCycleMonthKey, setBillingCycleMonthKey] = useState(getMonthKey());
  const [isHydrated, setIsHydrated] = useState(false);

  const [isBillModalOpen, setIsBillModalOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"add" | "edit">("add");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [billName, setBillName] = useState("");
  const [billDueDay, setBillDueDay] = useState("");

  const [pendingReceiptTarget, setPendingReceiptTarget] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<
    { title: string; date?: string; receiptDataUrl?: string; receiptName?: string } | null
  >(null);

  const receiptInputRef = useRef<HTMLInputElement>(null);
  const receiptCameraInputRef = useRef<HTMLInputElement>(null);

  // Hydrate from localStorage
  useEffect(() => {
    const snapshot = loadSnapshot();
    const storedTheme =
      (typeof window !== "undefined" && (window.localStorage.getItem(THEME_KEY) as "light" | "dark" | null)) || null;
    setTheme(storedTheme ?? "light");

    if (snapshot) {
      const currentMonthKey = getMonthKey();
      const shouldReset = snapshot.billingCycleMonthKey !== currentMonthKey;
      setBills(shouldReset ? resetBillsForNewMonth(snapshot.bills ?? defaultBills) : snapshot.bills ?? defaultBills);
      setPaymentHistory(snapshot.paymentHistory ?? []);
      setBillingCycleMonthKey(currentMonthKey);
    }
    setIsHydrated(true);
  }, []);

  // Persist
  useEffect(() => {
    if (!isHydrated) return;
    saveSnapshot({ bills, paymentHistory, billingCycleMonthKey });
    window.localStorage.setItem(THEME_KEY, theme);
  }, [bills, paymentHistory, billingCycleMonthKey, theme, isHydrated]);

  // Theme attribute
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Monthly rollover
  useEffect(() => {
    if (!isHydrated) return;
    const tick = () => {
      const currentMonthKey = getMonthKey();
      setBillingCycleMonthKey((prev) => {
        if (prev === currentMonthKey) return prev;
        setBills((curr) => resetBillsForNewMonth(curr));
        return currentMonthKey;
      });
    };
    tick();
    const id = window.setInterval(tick, 60 * 1000);
    return () => window.clearInterval(id);
  }, [isHydrated]);

  const isDark = theme === "dark";
  const currentDateLabel = new Intl.DateTimeFormat("en-PH", {
    month: "short", day: "numeric", year: "numeric",
  }).format(new Date());
  const currentMonthLabel = new Intl.DateTimeFormat("en-PH", {
    month: "long", year: "numeric",
  }).format(new Date());


  const upsertHistory = (bill: Bill, receiptDataUrl: string, receiptName: string) => {
    const monthKey = getMonthKey();
    const uniqueKey = `${bill.id}-${monthKey}`;
    setPaymentHistory((curr) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        uniqueKey,
        monthKey,
        date: formatPaidDate(),
        timestamp: new Date().toISOString(),
        title: bill.name,
        receiptDataUrl,
        receiptName,
      },
      ...curr.filter((h) => h.uniqueKey !== uniqueKey),
    ]);
  };

  const removeHistory = (uniqueKey: string) =>
    setPaymentHistory((curr) => curr.filter((h) => h.uniqueKey !== uniqueKey));

  const openReceiptPicker = (id: string, mode: "gallery" | "camera") => {
    setPendingReceiptTarget(id);
    const ref = mode === "camera" ? receiptCameraInputRef : receiptInputRef;
    if (ref.current) {
      ref.current.value = "";
      ref.current.click();
    }
  };

  const handleReceiptUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const targetId = pendingReceiptTarget;
    if (!file || !targetId) return;
    const reader = new FileReader();
    reader.onload = () => {
      const receiptDataUrl = String(reader.result ?? "");
      let updated: Bill | undefined;
      setBills((curr) =>
        curr.map((b) => {
          if (b.id !== targetId) return b;
          updated = {
            ...b,
            paid: true,
            paidDate: formatPaidDate(),
            receiptDataUrl,
            receiptName: file.name,
          };
          return updated;
        }),
      );
      if (updated) upsertHistory(updated, receiptDataUrl, file.name);
      setPendingReceiptTarget(null);
    };
    reader.readAsDataURL(file);
  };

  const clearBillReceipt = (id: string) => {
    const uniqueKey = `${id}-${getMonthKey()}`;
    setBills((curr) =>
      curr.map((b) => (b.id === id ? { ...b, paid: false, paidDate: "", receiptDataUrl: "", receiptName: "" } : b)),
    );
    removeHistory(uniqueKey);
  };

  const openAddModal = () => {
    setEditorMode("add");
    setEditingId(null);
    setBillName("");
    setBillDueDay("");
    setIsBillModalOpen(true);
  };

  const openEditModal = (bill: Bill) => {
    setEditorMode("edit");
    setEditingId(bill.id);
    setBillName(bill.name);
    setBillDueDay(bill.dueDay);
    setIsBillModalOpen(true);
  };

  const closeBillModal = () => {
    setIsBillModalOpen(false);
    setEditingId(null);
    setBillName("");
    setBillDueDay("");
  };

  const saveBill = () => {
    const name = billName.trim();
    const dueDay = billDueDay.trim();
    if (!name || !dueDay) return;

    setBills((curr) =>
      editorMode === "edit"
        ? curr.map((b) => (b.id === editingId ? { ...b, name, dueDay } : b))
        : [
            ...curr,
            {
              id: `${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
              name,
              dueDay,
              paid: false,
              paidDate: "",
            },
          ],
    );
    closeBillModal();
  };

  const deleteBill = (id: string) => {
    const uniqueKey = `${id}-${getMonthKey()}`;
    setBills((curr) => curr.filter((b) => b.id !== id));
    removeHistory(uniqueKey);
  };

  const historyEntries = [...paymentHistory].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const historyByMonth = monthLabels.map((monthLabel, index) => {
    const monthEntries = historyEntries.filter((entry) => {
      const entryDate = new Date(entry.timestamp);
      return entryDate.getMonth() === index;
    });
    const monthlyBills = monthEntries.reduce<HistoryEntry[]>((acc, entry) => {
      if (!acc.some((item) => item.title === entry.title)) acc.push(entry);
      return acc;
    }, []);
    return { monthLabel, monthlyBills };
  });

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

            {/* Hamburger removed — single-page app */}


            <button
              type="button"
              className="theme-toggle"
              onClick={() => setTheme(isDark ? "light" : "dark")}
              aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
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
            <span className="date-pill" aria-label={`Current date ${currentDateLabel}`}>
              {currentDateLabel}
            </span>
          </div>
        </header>

        {/* Mobile nav removed — single-page app */}


        <main className="content">
            <section className="list-card" aria-label="Monthly bills">
              <div className="section-head">
                <h2>Monthly bills — {currentMonthLabel}</h2>
              </div>


              <button type="button" className="nav-pill biller-add-button" onClick={openAddModal}>
                Add bill
              </button>

              {bills.map((bill) => {
                const isPaid = Boolean(bill.paid || bill.receiptDataUrl);
                const dueInfo = getDueInfo(bill.dueDay);
                return (
                  <div className="bill-row" key={bill.id}>
                    <div className="bill-meta">
                      <strong>{bill.name}</strong>
                      <span>Due every {bill.dueDay}</span>
                      <span className={`due-badge ${isPaid ? "is-paid" : dueInfo.tone}`}>
                        {isPaid ? "Paid" : dueInfo.label}
                      </span>
                    </div>

                    <div className="bill-actions">
                      <button type="button" className="status-toggle" onClick={() => openEditModal(bill)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="delete-toggle"
                        onClick={() => setPendingDeleteId(bill.id)}
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
                            onClick={() => clearBillReceipt(bill.id)}
                          >
                            Undo
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="status-toggle"
                            onClick={() => openReceiptPicker(bill.id, "camera")}
                          >
                            Camera
                          </button>
                          <button
                            type="button"
                            className="status-toggle"
                            onClick={() => openReceiptPicker(bill.id, "gallery")}
                          >
                            Gallery
                          </button>
                        </>
                      )}

                    </div>
                  </div>
                );
              })}
            </section>
          </main>
        {/* History view commented out — kept for future use
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
                        <button type="button" key={entry.id} className="history-view-button history-bill-button" onClick={() => setReceiptPreview({ title: entry.title, receiptDataUrl: entry.receiptDataUrl, receiptName: entry.receiptName })}>
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
        */}

      </div>

      <input ref={receiptInputRef} type="file" accept="image/*" hidden onChange={handleReceiptUpload} />
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
            {receiptPreview.receiptDataUrl ? (
              <img
                className="receipt-image"
                src={receiptPreview.receiptDataUrl}
                alt={receiptPreview.receiptName ?? "Receipt preview"}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {pendingDeleteId ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal confirm-modal">
            <h3>Delete this bill?</h3>
            <p className="confirm-text">
              This will remove <strong>{bills.find((b) => b.id === pendingDeleteId)?.name}</strong> from your monthly bills. This action can't be undone.
            </p>
            <div className="modal-actions">
              <button type="button" className="status-toggle" onClick={() => setPendingDeleteId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="delete-toggle delete-confirm"
                onClick={() => {
                  deleteBill(pendingDeleteId);
                  setPendingDeleteId(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isBillModalOpen ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              saveBill();
            }}
          >
            <h3>{editorMode === "edit" ? "Edit bill" : "Add bill"}</h3>
            <div className="biller-modal-fields">
              <label className="modal-field">
                <span>Name</span>
                <input
                  type="text"
                  value={billName}
                  onChange={(e) => setBillName(e.target.value)}
                  placeholder="e.g. Internet"
                  autoFocus
                />
              </label>
              <label className="modal-field">
                <span>Due date</span>
                <input
                  type="text"
                  value={billDueDay}
                  onChange={(e) => setBillDueDay(e.target.value)}
                  placeholder="e.g. 15th"
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="status-toggle" onClick={closeBillModal}>
                Cancel
              </button>
              <button type="submit" className="nav-pill">
                {editorMode === "edit" ? "Save changes" : "Add bill"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
