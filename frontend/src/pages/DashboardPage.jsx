import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

const DAILY_TARGET = 5000;

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user, branchId, branchCode, branchName, branchLocation } = useAuth();

  const displayName =
    user?.full_name ||
    user?.fullName ||
    user?.name ||
    user?.username ||
    "User";

  const currentStoreCode =
    branchCode ||
    user?.branch_code ||
    user?.selected_branch?.branch_code ||
    user?.selected_branch?.code ||
    "STORE";

  const currentStoreName =
    branchName ||
    user?.branch_name ||
    user?.selected_branch?.branch_name ||
    user?.selected_branch?.name ||
    "Selected Store";

  const currentStoreLocation =
    branchLocation ||
    user?.branch_location ||
    user?.selected_branch?.branch_location ||
    user?.selected_branch?.location ||
    "";

  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [debtSummary, setDebtSummary] = useState(null);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [isMobile, setIsMobile] = useState(false);

  const role = String(user?.role || "").toLowerCase();
  const canManage = role === "admin" || role === "manager";

  function formatMoney(value) {
    return Number(value || 0).toLocaleString("en-GH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function formatCompactMoney(value) {
    const number = Number(value || 0);

    if (number >= 1000000) {
      return `GHS ${(number / 1000000).toFixed(1)}M`;
    }

    if (number >= 1000) {
      return `GHS ${(number / 1000).toFixed(1)}K`;
    }

    return `GHS ${formatMoney(number)}`;
  }

  function formatTime(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatDate(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  function getSaleDate(sale) {
    return new Date(sale?.created_at || sale?.sale_date || sale?.date);
  }

  function isSameDay(dateA, dateB) {
    return (
      dateA.getFullYear() === dateB.getFullYear() &&
      dateA.getMonth() === dateB.getMonth() &&
      dateA.getDate() === dateB.getDate()
    );
  }

  function isSameMonth(dateA, dateB) {
    return (
      dateA.getFullYear() === dateB.getFullYear() &&
      dateA.getMonth() === dateB.getMonth()
    );
  }

  function isWithinLastDays(date, days) {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);

    return date >= start && date <= now;
  }

  function isSaleVoided(sale) {
    return (
      Number(sale?.is_voided || 0) === 1 ||
      String(sale?.sale_status || "").toLowerCase() === "cancelled" ||
      String(sale?.sale_status || "").toLowerCase() === "voided"
    );
  }

  function isActiveCompletedSale(sale) {
    const status = String(sale?.sale_status || "completed").toLowerCase();
    return !isSaleVoided(sale) && status === "completed";
  }

  function getPaymentType(sale) {
    return String(sale?.payment_type || "cash").toLowerCase();
  }

  async function loadDashboard() {
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const [productsResponse, salesResponse, debtsResponse] =
        await Promise.all([
          axiosClient.get("/products"),
          axiosClient.get("/sales"),
          axiosClient.get("/debts/summary"),
        ]);

      setProducts(productsResponse.data.products || []);
      setSales(salesResponse.data.sales || []);
      setDebtSummary(debtsResponse.data.summary || debtsResponse.data || null);
      setMessage("Dashboard refreshed successfully.");
    } catch (error) {
      setError(error.response?.data?.message || "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
    // Reload dashboard when the selected store changes.
  }, [branchId]);

  useEffect(() => {
    function checkScreenSize() {
      setIsMobile(window.innerWidth <= 760);
    }

    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);

    return () => {
      window.removeEventListener("resize", checkScreenSize);
    };
  }, []);

  const dashboardData = useMemo(() => {
    const today = new Date();

    const activeSales = sales.filter(isActiveCompletedSale);
    const voidedSales = sales.filter(isSaleVoided);

    const todaySales = activeSales.filter((sale) => {
      const saleDate = getSaleDate(sale);
      return !Number.isNaN(saleDate.getTime()) && isSameDay(saleDate, today);
    });

    const monthSales = activeSales.filter((sale) => {
      const saleDate = getSaleDate(sale);
      return !Number.isNaN(saleDate.getTime()) && isSameMonth(saleDate, today);
    });

    const weekSales = activeSales.filter((sale) => {
      const saleDate = getSaleDate(sale);
      return !Number.isNaN(saleDate.getTime()) && isWithinLastDays(saleDate, 7);
    });

    const lowStockProducts = products.filter(
      (product) =>
        Number(product.quantity || 0) <=
        Number(product.low_stock_threshold || 0)
    );

    const urgentLowStockProducts = lowStockProducts.filter(
      (product) => Number(product.quantity || 0) <= 2
    );

    const totalDiscountAmount = activeSales.reduce(
      (sum, sale) => sum + Number(sale.discount_amount || 0),
      0
    );

    const totalSalesAmount = activeSales.reduce(
      (sum, sale) => sum + Number(sale.total || 0),
      0
    );

    const todaySalesAmount = todaySales.reduce(
      (sum, sale) => sum + Number(sale.total || 0),
      0
    );

    const monthSalesAmount = monthSales.reduce(
      (sum, sale) => sum + Number(sale.total || 0),
      0
    );

    const weekSalesAmount = weekSales.reduce(
      (sum, sale) => sum + Number(sale.total || 0),
      0
    );

    const todayAmountPaid = todaySales.reduce(
      (sum, sale) => sum + Number(sale.amount_paid || 0),
      0
    );

    const stockValue = products.reduce((sum, product) => {
      return (
        sum +
        Number(product.quantity || 0) * Number(product.selling_price || 0)
      );
    }, 0);

    const costValue = products.reduce((sum, product) => {
      return (
        sum + Number(product.quantity || 0) * Number(product.cost_price || 0)
      );
    }, 0);

    const estimatedProfit = Math.max(stockValue - costValue, 0);

    const outstandingDebts =
      debtSummary?.outstanding_balance ??
      debtSummary?.outstanding_debts ??
      debtSummary?.total_outstanding_balance ??
      debtSummary?.total_balance ??
      0;

    const activeDebtCount =
      debtSummary?.active_debt_count ??
      debtSummary?.unpaid_count ??
      debtSummary?.partial_count ??
      debtSummary?.count ??
      0;

    const overdueDebtCount = debtSummary?.overdue_count ?? 0;

    const paymentBreakdown = {
      cash: 0,
      momo: 0,
      bank: 0,
      credit: 0,
      other: 0,
    };

    activeSales.forEach((sale) => {
      const paymentType = getPaymentType(sale);
      const total = Number(sale.total || 0);

      if (paymentType.includes("cash")) {
        paymentBreakdown.cash += total;
      } else if (
        paymentType.includes("momo") ||
        paymentType.includes("mobile")
      ) {
        paymentBreakdown.momo += total;
      } else if (paymentType.includes("bank")) {
        paymentBreakdown.bank += total;
      } else if (
        paymentType.includes("credit") ||
        Number(sale.balance || 0) > 0
      ) {
        paymentBreakdown.credit += total;
      } else {
        paymentBreakdown.other += total;
      }
    });

    const lastSevenDays = Array.from({ length: 7 }).map((_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      date.setHours(0, 0, 0, 0);

      const amount = activeSales.reduce((sum, sale) => {
        const saleDate = getSaleDate(sale);

        if (Number.isNaN(saleDate.getTime())) {
          return sum;
        }

        return isSameDay(saleDate, date) ? sum + Number(sale.total || 0) : sum;
      }, 0);

      return {
        label: date.toLocaleDateString("en-GB", { weekday: "short" }),
        amount,
      };
    });

    const topStockProducts = [...products]
      .map((product) => ({
        ...product,
        stockValue:
          Number(product.quantity || 0) * Number(product.selling_price || 0),
      }))
      .sort((a, b) => b.stockValue - a.stockValue)
      .slice(0, 6);

    const restockWatch = [...lowStockProducts]
      .sort((a, b) => {
        const aQty = Number(a.quantity || 0);
        const bQty = Number(b.quantity || 0);
        return aQty - bQty;
      })
      .slice(0, 6);

    const stockHealth =
      products.length === 0
        ? 100
        : Math.max(
            0,
            Math.round(
              ((products.length - lowStockProducts.length) / products.length) *
                100
            )
          );

    const debtRisk =
      totalSalesAmount <= 0
        ? 0
        : Math.min(
            100,
            Math.round((Number(outstandingDebts || 0) / totalSalesAmount) * 100)
          );

    const targetProgress = Math.min(
      100,
      Math.round((todaySalesAmount / DAILY_TARGET) * 100)
    );

    const salesScore =
      targetProgress >= 100 ? 30 : Math.round((targetProgress / 100) * 30);

    const stockScore = Math.round((stockHealth / 100) * 30);
    const debtScore = Math.max(0, Math.round(((100 - debtRisk) / 100) * 25));
    const auditScore = voidedSales.length === 0 ? 15 : 8;

    const businessScore = Math.min(
      100,
      Math.max(0, salesScore + stockScore + debtScore + auditScore)
    );

    let businessScoreLabel = "Needs Attention";
    let businessScoreTone = "red";

    if (businessScore >= 80) {
      businessScoreLabel = "Strong";
      businessScoreTone = "green";
    } else if (businessScore >= 60) {
      businessScoreLabel = "Stable";
      businessScoreTone = "blue";
    } else if (businessScore >= 40) {
      businessScoreLabel = "Watch Closely";
      businessScoreTone = "orange";
    }

    const smartAlerts = [];

    if (products.length === 0) {
      smartAlerts.push({
        id: "no-products",
        icon: "📦",
        title: "No products recorded yet",
        description:
          "Add products before starting full business operations. Stock value and alerts will become active after products are added.",
        action: "Add Products",
        path: "/products",
        tone: "blue",
      });
    }

    if (lowStockProducts.length > 0) {
      smartAlerts.push({
        id: "low-stock",
        icon: urgentLowStockProducts.length > 0 ? "🚨" : "⚠️",
        title: `${lowStockProducts.length} product(s) need restocking`,
        description:
          urgentLowStockProducts.length > 0
            ? `${urgentLowStockProducts.length} item(s) are critically low. Restock quickly to avoid losing sales.`
            : "Some products are near or below their low stock level. Review stock before busy sales hours.",
        action: "Review Stock",
        path: "/products",
        tone: urgentLowStockProducts.length > 0 ? "red" : "orange",
      });
    }

    if (Number(outstandingDebts || 0) > 0) {
      smartAlerts.push({
        id: "debt-follow-up",
        icon: "📞",
        title: "Customer debt follow-up needed",
        description: `${formatCompactMoney(
          outstandingDebts
        )} is still outstanding from ${activeDebtCount} active debt record(s). Use WhatsApp reminders to follow up.`,
        action: "Open Debts",
        path: "/debts",
        tone: overdueDebtCount > 0 ? "red" : "orange",
      });
    }

    if (todaySalesAmount <= 0) {
      smartAlerts.push({
        id: "no-sales-today",
        icon: "🕘",
        title: "No sales recorded today",
        description:
          "Today has no completed sales yet. Start recording sales when business begins.",
        action: "Start New Sale",
        path: "/new-sale",
        tone: "blue",
      });
    } else if (targetProgress < 50) {
      smartAlerts.push({
        id: "target-low",
        icon: "🎯",
        title: "Daily sales target is still low",
        description: `Today’s sales are at ${targetProgress}% of the daily target. Push more sales before closing.`,
        action: "New Sale",
        path: "/new-sale",
        tone: "orange",
      });
    } else if (targetProgress >= 100) {
      smartAlerts.push({
        id: "target-hit",
        icon: "🏆",
        title: "Daily target achieved",
        description:
          "Today’s sales have reached or passed the target. Keep monitoring stock and cash before closing.",
        action: "Daily Closing",
        path: "/daily-closing",
        tone: "green",
      });
    }

    if (voidedSales.length > 0) {
      smartAlerts.push({
        id: "voided-sales",
        icon: "🛡️",
        title: "Voided sales detected",
        description: `${voidedSales.length} voided/cancelled sale(s) exist. Boss should review them during audit or daily closing.`,
        action: "View Reports",
        path: "/reports",
        tone: "red",
      });
    }

    if (smartAlerts.length === 0) {
      smartAlerts.push({
        id: "healthy-business",
        icon: "✅",
        title: "Business looks healthy",
        description:
          "No urgent issues detected. Sales, stock and debt indicators currently look stable.",
        action: "View Reports",
        path: "/reports",
        tone: "green",
      });
    }

    const actionPlan = [];

    if (lowStockProducts.length > 0) {
      actionPlan.push({
        id: "restock",
        title: "Restock priority items",
        note: `${lowStockProducts.length} product(s) are at or below low stock level.`,
        path: "/products",
      });
    }

    if (Number(outstandingDebts || 0) > 0) {
      actionPlan.push({
        id: "collect-debt",
        title: "Follow up customer debts",
        note: `${formatCompactMoney(outstandingDebts)} is still outstanding.`,
        path: "/debts",
      });
    }

    if (todaySalesAmount > 0) {
      actionPlan.push({
        id: "close-day",
        title: "Prepare daily closing",
        note: `Today’s sales are ${formatCompactMoney(todaySalesAmount)} so far.`,
        path: "/daily-closing",
      });
    }

    if (actionPlan.length === 0) {
      actionPlan.push({
        id: "start-business",
        title: "Start business activity",
        note: "Record products, sales and payments to activate stronger insights.",
        path: "/new-sale",
      });
    }

    const bossBrief = [
      `Today: ${formatCompactMoney(todaySalesAmount)} from ${todaySales.length} sale(s).`,
      `This week: ${formatCompactMoney(weekSalesAmount)} in completed sales.`,
      `Stock health is ${stockHealth}%, with ${lowStockProducts.length} low-stock item(s).`,
      `Outstanding debts stand at ${formatCompactMoney(outstandingDebts)}.`,
    ];

    return {
      activeSales,
      voidedSales,
      todaySales,
      monthSales,
      weekSales,
      lowStockProducts,
      urgentLowStockProducts,
      totalProducts: products.length,
      lowStockCount: lowStockProducts.length,
      totalDiscountAmount,
      totalSalesAmount,
      todaySalesAmount,
      monthSalesAmount,
      weekSalesAmount,
      todayAmountPaid,
      stockValue,
      costValue,
      estimatedProfit,
      outstandingDebts,
      activeDebtCount,
      overdueDebtCount,
      paymentBreakdown,
      lastSevenDays,
      topStockProducts,
      restockWatch,
      stockHealth,
      debtRisk,
      targetProgress,
      businessScore,
      businessScoreLabel,
      businessScoreTone,
      smartAlerts,
      actionPlan,
      bossBrief,
    };
    // Pure display helpers are intentionally stable for the lifetime of this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, sales, debtSummary]);

  const recentSales = [...sales].slice(0, 8);

  const chartMax = Math.max(
    ...dashboardData.lastSevenDays.map((item) => item.amount),
    1
  );

  const chartPoints = dashboardData.lastSevenDays
    .map((item, index) => {
      const width = 620;
      const height = 210;
      const x = index * (width / 6);
      const y = height - 24 - (item.amount / chartMax) * 150;
      return `${x},${y}`;
    })
    .join(" ");

  const paymentTotal = Object.values(dashboardData.paymentBreakdown).reduce(
    (sum, value) => sum + value,
    0
  );

  function paymentPercent(value) {
    if (!paymentTotal) return 0;
    return Math.round((Number(value || 0) / paymentTotal) * 100);
  }

  const paymentGradient = buildPaymentGradient(dashboardData.paymentBreakdown);

  const kpiCards = [
    {
      label: "Today’s Sales",
      value: `GHS ${formatMoney(dashboardData.todaySalesAmount)}`,
      note: `${dashboardData.todaySales.length} transaction(s) today`,
      icon: "⚡",
      trend: "Live today",
      tone: "gold",
    },
    {
      label: "Monthly Revenue",
      value: `GHS ${formatMoney(dashboardData.monthSalesAmount)}`,
      note: `${dashboardData.monthSales.length} completed sale(s) this month`,
      icon: "📈",
      trend: "Monthly flow",
      tone: "blue",
    },
    {
      label: "Cash Collected",
      value: `GHS ${formatMoney(dashboardData.todayAmountPaid)}`,
      note: "Money received today",
      icon: "💰",
      trend: "Collected",
      tone: "green",
    },
    {
      label: "Outstanding Debts",
      value: `GHS ${formatMoney(dashboardData.outstandingDebts)}`,
      note: `${dashboardData.activeDebtCount} active debt record(s)`,
      icon: "🧾",
      trend: `${dashboardData.debtRisk}% risk`,
      tone: "orange",
    },
    {
      label: "Low Stock Risk",
      value: dashboardData.lowStockCount,
      note: `${dashboardData.urgentLowStockProducts.length} urgent item(s)`,
      icon: "🚨",
      trend: "Restock watch",
      tone: "red",
    },
    {
      label: "Inventory Value",
      value: `GHS ${formatMoney(dashboardData.stockValue)}`,
      note: "Estimated selling value",
      icon: "🏗️",
      trend: `${dashboardData.stockHealth}% healthy`,
      tone: "navy",
    },
  ];

  const oneColumn = isMobile ? styles.oneColumn : {};
  const mobileHeroTop = isMobile ? styles.heroTopMobile : {};
  const mobileBrandCluster = isMobile ? styles.brandClusterMobile : {};
  const mobileHeroLogo = isMobile ? styles.heroLogoMobile : {};
  const mobileHeroTitle = isMobile ? styles.heroTitleMobile : {};
  const mobileQuickActions = isMobile ? styles.quickActionsMobile : {};
  const mobileSmartCard = isMobile ? styles.smartCardMobile : {};
  const mobileScoreBody = isMobile ? styles.scoreBodyMobile : {};
  const mobilePage = isMobile ? styles.pageMobile : {};

  return (
    <div style={{ ...styles.page, ...mobilePage }}>
      <div style={{ ...styles.hero, ...(isMobile ? styles.heroMobile : {}) }}>
        <div style={styles.heroGlowOne} />
        <div style={styles.heroGlowTwo} />

        <div style={styles.heroContent}>
          <div style={{ ...styles.heroTop, ...mobileHeroTop }}>
            <div style={{ ...styles.brandCluster, ...mobileBrandCluster }}>
              <img
                src="/chalin03-logo.png"
                alt="Chalin 03 Logo"
                style={{ ...styles.heroLogo, ...mobileHeroLogo }}
              />

              <div>
                <p style={styles.eyebrow}>
                  Business Command Center • {currentStoreCode}
                </p>

                <h1 style={{ ...styles.heroTitle, ...mobileHeroTitle }}>
                  Welcome back, {displayName}
                </h1>

                <p style={styles.heroSubtitle}>
                  Real-time view of sales, stock, debts, cash movement, urgent
                  alerts and boss-level business intelligence for{" "}
                  <strong>{currentStoreName}</strong>
                  {currentStoreLocation ? ` - ${currentStoreLocation}` : ""}.
                  Every figure here belongs to the selected store only.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={loadDashboard}
              disabled={loading}
              style={{
                ...styles.refreshButton,
                ...(isMobile ? styles.fullWidthButton : {}),
              }}
            >
              {loading ? "Refreshing..." : "Refresh Dashboard"}
            </button>
          </div>

          <div style={{ ...styles.heroMetrics, ...oneColumn }}>
            <HeroMetric label="Store : " value={currentStoreCode} />

            <HeroMetric
              label="Today : "
              value={`GHS ${formatMoney(dashboardData.todaySalesAmount)}`}
            />

            <HeroMetric
              label="This Week : "
              value={`GHS ${formatMoney(dashboardData.weekSalesAmount)}`}
            />

            <HeroMetric
              label="Stock Health :"
              value={`${dashboardData.stockHealth}%`}
            />

            <HeroMetric
              label="Business Score : "
              value={`${dashboardData.businessScore}%`}
            />
          </div>
        </div>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div
        style={{
          ...styles.storeNotice,
          ...(isMobile ? styles.storeNoticeMobile : {}),
        }}
      >
        <span>🏬</span>
        <div>
          <strong>
            {currentStoreCode} — {currentStoreName}
          </strong>
          <p>
            Dashboard data is filtered to this selected store. Logout and choose
            another store to view a different branch.
          </p>
        </div>
      </div>

      <div style={{ ...styles.quickActions, ...mobileQuickActions }}>
        <button style={styles.actionPrimary} onClick={() => navigate("/new-sale")}>
          <span>＋</span> New Sale
        </button>

        <button style={styles.actionButton} onClick={() => navigate("/products")}>
          📦 Products
        </button>

        <button style={styles.actionButton} onClick={() => navigate("/debts")}>
          📞 Debts
        </button>

        <button style={styles.actionButton} onClick={() => navigate("/reports")}>
          📊 Reports
        </button>

        <button style={styles.actionButton} onClick={() => navigate("/daily-closing")}>
          🌙 Daily Closing
        </button>

        {canManage && (
          <>
            <button style={styles.actionButton} onClick={() => navigate("/expenses")}>
              ⛽ Expenses
            </button>

            <button style={styles.actionButton} onClick={() => navigate("/stock-transfers")}>
              🔁 Stock Transfers
            </button>

            <button style={styles.actionPremium} onClick={() => navigate("/audit-accounting")}>
              🧮 Audit Review
            </button>

            <button style={styles.actionPremium} onClick={() => navigate("/advanced-accounting-intelligence")}>
              📈 Intelligence
            </button>

            <button style={styles.actionPremium} onClick={() => navigate("/sms")}>
              📩 SMS Center
            </button>
          </>
        )}
      </div>

      <div style={{ ...styles.missionGrid, ...oneColumn }}>
        <MissionCard
          icon="⚡"
          label="Today’s Activity"
          value={`${dashboardData.todaySales.length} sale(s)`}
          note={formatCompactMoney(dashboardData.todaySalesAmount)}
        />

        <MissionCard
          icon="💵"
          label="Cash Collected"
          value={formatCompactMoney(dashboardData.todayAmountPaid)}
          note="Money received today"
        />

        <MissionCard
          icon="📦"
          label="Stock Watch"
          value={`${dashboardData.lowStockCount} low item(s)`}
          note={`${dashboardData.stockHealth}% stock health`}
        />

        <MissionCard
          icon="🛡️"
          label="Control Check"
          value={`${dashboardData.voidedSales.length} voided`}
          note={`${dashboardData.businessScore}% business score`}
        />
      </div>

      <div style={{ ...styles.executiveGrid, ...oneColumn }}>
        <div style={styles.scorePanel}>
          <div style={styles.scoreHeader}>
            <div>
              <p style={styles.eyebrowDark}>Executive Intelligence</p>
              <h2 style={styles.scoreTitle}>Business Health Score</h2>
              <p style={styles.scoreSubtitle}>
                A quick boss-level score based on sales target, stock health,
                debt risk and audit safety.
              </p>
            </div>

            <span
              style={{
                ...styles.scoreStatus,
                ...smartToneStyles[dashboardData.businessScoreTone],
              }}
            >
              {dashboardData.businessScoreLabel}
            </span>
          </div>

          <div style={{ ...styles.scoreBody, ...mobileScoreBody }}>
            <div
              style={{
                ...styles.scoreRing,
                background: `conic-gradient(#e0ba28 0deg ${
                  dashboardData.businessScore * 3.6
                }deg, #e2e8f0 ${
                  dashboardData.businessScore * 3.6
                }deg 360deg)`,
              }}
            >
              <div style={styles.scoreInner}>
                <strong>{dashboardData.businessScore}%</strong>
                <span>Score</span>
              </div>
            </div>

            <div style={styles.bossBrief}>
              <h3>Boss Daily Brief</h3>

              {dashboardData.bossBrief.map((brief) => (
                <p key={brief}>• {brief}</p>
              ))}
            </div>
          </div>
        </div>

        <div style={styles.actionPlanPanel}>
          <div style={styles.panelHeader}>
            <div>
              <h2 style={styles.panelTitle}>Today’s Action Plan</h2>
              <p style={styles.panelSubtitle}>
                The most important things to check before closing.
              </p>
            </div>
          </div>

          <div style={styles.actionPlanList}>
            {dashboardData.actionPlan.map((action, index) => (
              <button
                type="button"
                key={action.id}
                style={styles.actionPlanItem}
                onClick={() => navigate(action.path)}
              >
                <span>{index + 1}</span>

                <div>
                  <strong>{action.title}</strong>
                  <small>{action.note}</small>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={styles.smartCenter}>
        <div style={styles.smartCenterHeader}>
          <div>
            <p style={styles.eyebrowDark}>System Intelligence</p>
            <h2 style={styles.smartTitle}>Smart Business Alerts Center</h2>
            <p style={styles.smartSubtitle}>
              Automatic business warnings and action suggestions for the boss.
            </p>
          </div>

          <span style={styles.smartBadge}>
            {dashboardData.smartAlerts.length} active insight(s)
          </span>
        </div>

        <div style={{ ...styles.smartGrid, ...(isMobile ? oneColumn : {}) }}>
          {dashboardData.smartAlerts.map((alert) => (
            <div
              key={alert.id}
              style={{
                ...styles.smartCard,
                ...mobileSmartCard,
                ...smartToneStyles[alert.tone],
              }}
            >
              <div style={styles.smartIcon}>{alert.icon}</div>

              <div style={styles.smartBody}>
                <strong>{alert.title}</strong>
                <p>{alert.description}</p>

                <button
                  type="button"
                  style={styles.smartActionButton}
                  onClick={() => navigate(alert.path)}
                >
                  {alert.action}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...styles.kpiGrid, ...oneColumn }}>
        {kpiCards.map((card) => (
          <div key={card.label} style={styles.kpiCard}>
            <div style={styles.kpiTop}>
              <div style={{ ...styles.kpiIcon, ...toneBackgrounds[card.tone] }}>
                {card.icon}
              </div>

              <span style={{ ...styles.trendPill, ...tonePills[card.tone] }}>
                {card.trend}
              </span>
            </div>

            <p style={styles.kpiLabel}>{card.label}</p>
            <strong style={styles.kpiValue}>{card.value}</strong>
            <span style={styles.kpiNote}>{card.note}</span>
          </div>
        ))}
      </div>

      <div style={{ ...styles.bigGrid, ...oneColumn }}>
        <div style={styles.panelLarge}>
          <div style={styles.panelHeader}>
            <div>
              <h2 style={styles.panelTitle}>Sales Performance</h2>
              <p style={styles.panelSubtitle}>Last 7 days revenue movement</p>
            </div>

            <span style={styles.goldBadge}>
              {formatCompactMoney(dashboardData.weekSalesAmount)}
            </span>
          </div>

          <div style={styles.chartBox}>
            <svg viewBox="0 0 620 230" style={styles.svgChart}>
              <defs>
                <linearGradient id="lineGold" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" stopColor="#e0ba28" />
                  <stop offset="100%" stopColor="#22c55e" />
                </linearGradient>
              </defs>

              {[0, 1, 2, 3].map((line) => (
                <line
                  key={line}
                  x1="0"
                  x2="620"
                  y1={35 + line * 45}
                  y2={35 + line * 45}
                  stroke="rgba(148, 163, 184, 0.22)"
                  strokeWidth="1"
                />
              ))}

              <polyline
                points={chartPoints}
                fill="none"
                stroke="url(#lineGold)"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {dashboardData.lastSevenDays.map((item, index) => {
                const x = index * (620 / 6);
                const y = 210 - 24 - (item.amount / chartMax) * 150;

                return (
                  <g key={item.label}>
                    <circle cx={x} cy={y} r="7" fill="#e0ba28" />
                    <circle
                      cx={x}
                      cy={y}
                      r="13"
                      fill="rgba(224, 186, 40, 0.18)"
                    />
                    <text
                      x={x}
                      y="220"
                      textAnchor="middle"
                      fill="#64748b"
                      fontSize="13"
                      fontWeight="700"
                    >
                      {item.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <div>
              <h2 style={styles.panelTitle}>Payment Breakdown</h2>
              <p style={styles.panelSubtitle}>Cash, MoMo, bank and credit</p>
            </div>
          </div>

          <div style={styles.paymentCenter}>
            <div
              style={{
                ...styles.donut,
                background: paymentGradient,
              }}
            >
              <div style={styles.donutInner}>
                <strong>
                  {paymentPercent(dashboardData.paymentBreakdown.cash)}%
                </strong>
                <span>Cash</span>
              </div>
            </div>
          </div>

          <div style={styles.paymentList}>
            <PaymentLine
              label="Cash"
              color="#e0ba28"
              value={dashboardData.paymentBreakdown.cash}
              percent={paymentPercent(dashboardData.paymentBreakdown.cash)}
              formatMoney={formatMoney}
            />

            <PaymentLine
              label="MoMo"
              color="#22c55e"
              value={dashboardData.paymentBreakdown.momo}
              percent={paymentPercent(dashboardData.paymentBreakdown.momo)}
              formatMoney={formatMoney}
            />

            <PaymentLine
              label="Bank"
              color="#2563eb"
              value={dashboardData.paymentBreakdown.bank}
              percent={paymentPercent(dashboardData.paymentBreakdown.bank)}
              formatMoney={formatMoney}
            />

            <PaymentLine
              label="Credit"
              color="#f97316"
              value={dashboardData.paymentBreakdown.credit}
              percent={paymentPercent(dashboardData.paymentBreakdown.credit)}
              formatMoney={formatMoney}
            />
          </div>
        </div>
      </div>

      <div style={{ ...styles.midGrid, ...oneColumn }}>
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <div>
              <h2 style={styles.panelTitle}>Daily Target</h2>
              <p style={styles.panelSubtitle}>
                Target: GHS {formatMoney(DAILY_TARGET)}
              </p>
            </div>

            <span style={styles.goldBadge}>{dashboardData.targetProgress}%</span>
          </div>

          <div style={styles.progressTrack}>
            <div
              style={{
                ...styles.progressFill,
                width: `${dashboardData.targetProgress}%`,
              }}
            />
          </div>

          <p style={styles.targetText}>
            Today’s sales reached{" "}
            <strong>GHS {formatMoney(dashboardData.todaySalesAmount)}</strong>.
          </p>
        </div>

        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <div>
              <h2 style={styles.panelTitle}>Business Pulse</h2>
              <p style={styles.panelSubtitle}>Executive health snapshot</p>
            </div>
          </div>

          <div style={{ ...styles.pulseGrid, ...(isMobile ? oneColumn : {}) }}>
            <PulseItem
              label="Inventory Health"
              value={`${dashboardData.stockHealth}%`}
              tone="#22c55e"
            />
            <PulseItem
              label="Debt Risk"
              value={`${dashboardData.debtRisk}%`}
              tone="#f97316"
            />
            <PulseItem
              label="Voided Sales"
              value={dashboardData.voidedSales.length}
              tone="#dc2626"
            />
            <PulseItem
              label="Discount Given"
              value={`GHS ${formatMoney(dashboardData.totalDiscountAmount)}`}
              tone="#2563eb"
            />
          </div>
        </div>

        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <div>
              <h2 style={styles.panelTitle}>Restock Watch</h2>
              <p style={styles.panelSubtitle}>
                Items that may stop sales if ignored
              </p>
            </div>
          </div>

          {dashboardData.restockWatch.length === 0 ? (
            <div style={styles.emptyState}>
              No low-stock products. Stock looks healthy.
            </div>
          ) : (
            <div style={styles.alertList}>
              {dashboardData.restockWatch.map((product) => (
                <div key={product.id} style={styles.alertItem}>
                  <div>
                    <strong>{product.name}</strong>
                    <span>
                      {product.category || "No category"} •{" "}
                      {product.size || "No excavator type"}
                    </span>
                  </div>

                  <b>{Number(product.quantity || 0)} left</b>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ ...styles.bottomGrid, ...oneColumn }}>
        <div style={styles.panelLarge}>
          <div style={styles.panelHeader}>
            <div>
              <h2 style={styles.panelTitle}>Recent Sales</h2>
              <p style={styles.panelSubtitle}>Latest customer transactions</p>
            </div>
          </div>

          {recentSales.length === 0 ? (
            <div style={styles.emptyState}>No sales recorded yet.</div>
          ) : (
            <div style={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>Customer</th>
                    <th>Payment</th>
                    <th>Discount</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Time</th>
                  </tr>
                </thead>

                <tbody>
                  {recentSales.map((sale) => {
                    const voided = isSaleVoided(sale);

                    return (
                      <tr key={sale.id}>
                        <td>
                          <strong>
                            {sale.receipt_number || `Sale #${sale.id}`}
                          </strong>
                        </td>

                        <td>{sale.customer_name || "Walk-in Customer"}</td>

                        <td>
                          <span style={styles.paymentBadge}>
                            {sale.payment_type || "cash"}
                          </span>
                        </td>

                        <td>GHS {formatMoney(sale.discount_amount)}</td>

                        <td>
                          <strong>GHS {formatMoney(sale.total)}</strong>
                        </td>

                        <td>
                          {voided ? (
                            <span style={styles.badgeDanger}>Voided</span>
                          ) : (
                            <span style={styles.badgeSuccess}>
                              {sale.sale_status || "completed"}
                            </span>
                          )}
                        </td>

                        <td>{formatTime(sale.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={styles.sideStack}>
          <div style={styles.panel}>
            <div style={styles.panelHeader}>
              <div>
                <h2 style={styles.panelTitle}>Top Stock Value</h2>
                <p style={styles.panelSubtitle}>Highest value inventory</p>
              </div>
            </div>

            {dashboardData.topStockProducts.length === 0 ? (
              <div style={styles.emptyState}>No products yet.</div>
            ) : (
              <div style={styles.productList}>
                {dashboardData.topStockProducts.map((product, index) => (
                  <div key={product.id} style={styles.productItem}>
                    <span style={styles.rank}>{index + 1}</span>
                    <div>
                      <strong>{product.name}</strong>
                      <span>
                        Qty {product.quantity || 0} • GHS{" "}
                        {formatMoney(product.stockValue)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={styles.panelDark}>
            <h2 style={styles.darkTitle}>Boss View</h2>
            <p style={styles.darkText}>
              Valid sales are counted. Voided/cancelled sales are excluded from
              income. Debt exposure, low stock, cash movement and business score
              are monitored live.
            </p>

            <div
              style={{ ...styles.darkMiniGrid, ...(isMobile ? oneColumn : {}) }}
            >
              <div>
                <span>All Sales</span>
                <strong>GHS {formatMoney(dashboardData.totalSalesAmount)}</strong>
              </div>
              <div>
                <span>Profit View</span>
                <strong>GHS {formatMoney(dashboardData.estimatedProfit)}</strong>
              </div>
              <div>
                <span>Report Date</span>
                <strong>{formatDate(new Date())}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{dashboardData.businessScoreLabel}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroMetric({ label, value }) {
  return (
    <div style={styles.heroMetric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PaymentLine({ label, color, value, percent, formatMoney }) {
  return (
    <div style={styles.paymentLine}>
      <div>
        <span style={{ ...styles.dot, background: color }} />
        <strong>{label}</strong>
      </div>

      <span>
        GHS {formatMoney(value)} • {percent}%
      </span>
    </div>
  );
}

function PulseItem({ label, value, tone }) {
  return (
    <div style={styles.pulseItem}>
      <span style={{ background: tone }} />
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function MissionCard({ icon, label, value, note }) {
  return (
    <div style={styles.missionCard}>
      <div style={styles.missionIcon}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <span style={styles.missionLabel}>{label}</span>
        <strong style={styles.missionValue}>{value}</strong>
        <small style={styles.missionNote}>{note}</small>
      </div>
    </div>
  );
}

function buildPaymentGradient(paymentBreakdown) {
  const total = Object.values(paymentBreakdown).reduce(
    (sum, value) => sum + Number(value || 0),
    0
  );

  if (!total) {
    return "conic-gradient(#e0ba28 0deg, #e0ba28 360deg)";
  }

  const colors = [
    ["cash", "#e0ba28"],
    ["momo", "#22c55e"],
    ["bank", "#2563eb"],
    ["credit", "#f97316"],
    ["other", "#64748b"],
  ];

  let current = 0;

  const stops = colors.map(([key, color]) => {
    const value = Number(paymentBreakdown[key] || 0);
    const size = (value / total) * 360;
    const start = current;
    const end = current + size;
    current = end;
    return `${color} ${start}deg ${end}deg`;
  });

  return `conic-gradient(${stops.join(", ")})`;
}

const toneBackgrounds = {
  gold: { background: "rgba(224, 186, 40, 0.16)", color: "#a16207" },
  blue: { background: "rgba(37, 99, 235, 0.12)", color: "#1d4ed8" },
  green: { background: "rgba(34, 197, 94, 0.12)", color: "#15803d" },
  orange: { background: "rgba(249, 115, 22, 0.12)", color: "#c2410c" },
  red: { background: "rgba(220, 38, 38, 0.12)", color: "#b91c1c" },
  navy: { background: "rgba(7, 24, 44, 0.12)", color: "#07182c" },
};

const tonePills = {
  gold: { background: "#fef3c7", color: "#92400e" },
  blue: { background: "#dbeafe", color: "#1d4ed8" },
  green: { background: "#dcfce7", color: "#166534" },
  orange: { background: "#ffedd5", color: "#9a3412" },
  red: { background: "#fee2e2", color: "#991b1b" },
  navy: { background: "#e2e8f0", color: "#0f172a" },
};

const smartToneStyles = {
  green: {
    background: "linear-gradient(135deg, #ecfdf3, #ffffff)",
    borderColor: "#bbf7d0",
    color: "#14532d",
  },
  blue: {
    background: "linear-gradient(135deg, #eff6ff, #ffffff)",
    borderColor: "#bfdbfe",
    color: "#1e3a8a",
  },
  orange: {
    background: "linear-gradient(135deg, #fff7ed, #ffffff)",
    borderColor: "#fed7aa",
    color: "#9a3412",
  },
  red: {
    background: "linear-gradient(135deg, #fef2f2, #ffffff)",
    borderColor: "#fecaca",
    color: "#991b1b",
  },
};

const styles = {
  page: {
    width: "100%",
    maxWidth: "1760px",
    margin: "0 auto",
    paddingBottom: "46px",
  },

  pageMobile: {
    paddingBottom: "20px",
  },

  oneColumn: {
    gridTemplateColumns: "1fr",
  },

  hero: {
    position: "relative",
    overflow: "hidden",
    borderRadius: "34px",
    padding: "32px",
    marginBottom: "18px",
    background:
      "radial-gradient(circle at 86% 10%, rgba(224,186,40,0.34), transparent 26%), radial-gradient(circle at 42% 120%, rgba(37,99,235,0.35), transparent 34%), linear-gradient(135deg, #06101f 0%, #07182c 38%, #0d2f55 100%)",
    boxShadow: "0 24px 60px rgba(7, 24, 44, 0.28)",
    color: "#ffffff",
  },

  heroMobile: {
    padding: "18px 14px",
    borderRadius: "22px",
  },

  heroGlowOne: {
    position: "absolute",
    width: "260px",
    height: "260px",
    right: "-90px",
    top: "-90px",
    borderRadius: "50%",
    background: "rgba(224, 186, 40, 0.3)",
    filter: "blur(18px)",
  },

  heroGlowTwo: {
    position: "absolute",
    width: "180px",
    height: "180px",
    left: "35%",
    bottom: "-110px",
    borderRadius: "50%",
    background: "rgba(37, 99, 235, 0.35)",
    filter: "blur(18px)",
  },

  heroContent: {
    position: "relative",
    zIndex: 2,
  },

  heroTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: "20px",
    alignItems: "flex-start",
    flexWrap: "wrap",
  },

  heroTopMobile: {
    flexDirection: "column",
    alignItems: "stretch",
  },

  brandCluster: {
    display: "flex",
    alignItems: "center",
    gap: "18px",
  },

  brandClusterMobile: {
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
  },

  heroLogo: {
    width: "86px",
    height: "86px",
    objectFit: "cover",
    borderRadius: "22px",
    border: "3px solid rgba(224, 186, 40, 0.8)",
    boxShadow: "0 14px 30px rgba(0, 0, 0, 0.3)",
    background: "#000",
    flexShrink: 0,
  },

  heroLogoMobile: {
    width: "78px",
    height: "78px",
    borderRadius: "26px",
  },

  eyebrow: {
    margin: 0,
    color: "#e0ba28",
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontSize: "12px",
  },

  eyebrowDark: {
    margin: 0,
    color: "#b45309",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontSize: "12px",
  },

  heroTitle: {
    margin: "6px 0 0",
    fontSize: "clamp(28px, 4vw, 46px)",
    lineHeight: 1.05,
    fontWeight: "950",
  },

  heroTitleMobile: {
    fontSize: "25px",
    textAlign: "center",
  },

  heroSubtitle: {
    margin: "10px 0 0",
    maxWidth: "760px",
    color: "rgba(255,255,255,0.78)",
    fontSize: "15px",
    lineHeight: 1.6,
  },

  refreshButton: {
    border: "1px solid rgba(224, 186, 40, 0.65)",
    background: "rgba(224, 186, 40, 0.15)",
    color: "#ffffff",
    borderRadius: "14px",
    padding: "12px 16px",
    fontWeight: "900",
    cursor: "pointer",
  },

  fullWidthButton: {
    width: "100%",
  },

  heroMetrics: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: "14px",
    marginTop: "24px",
  },

  heroMetric: {
    padding: "13px",
    borderRadius: "17px",
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.14)",
  },

  storeNotice: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    marginBottom: "18px",
    padding: "14px 16px",
    borderRadius: "18px",
    background: "linear-gradient(135deg, #eff6ff, #ffffff)",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
  },

  storeNoticeMobile: {
    padding: "12px",
  },

  quickActions: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    marginBottom: "18px",
  },

  quickActionsMobile: {
    display: "grid",
    gridTemplateColumns: "1fr",
  },

  actionPrimary: {
    border: "none",
    background: "#e0ba28",
    color: "#07182c",
    borderRadius: "14px",
    padding: "12px 16px",
    fontWeight: "950",
    cursor: "pointer",
    boxShadow: "0 10px 24px rgba(224, 186, 40, 0.28)",
  },

  actionButton: {
    border: "1px solid #dbe3ef",
    background: "#ffffff",
    color: "#07182c",
    borderRadius: "14px",
    padding: "12px 16px",
    fontWeight: "900",
    cursor: "pointer",
    boxShadow: "0 8px 20px rgba(15, 23, 42, 0.06)",
  },

  actionPremium: {
    border: "1px solid rgba(224, 186, 40, 0.52)",
    background: "linear-gradient(135deg, #07182c, #0d2f55)",
    color: "#ffffff",
    borderRadius: "14px",
    padding: "12px 16px",
    fontWeight: "950",
    cursor: "pointer",
    boxShadow: "0 12px 28px rgba(7, 24, 44, 0.18)",
  },

  missionGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "14px",
    marginBottom: "18px",
  },

  missionCard: {
    display: "grid",
    gridTemplateColumns: "44px minmax(0, 1fr)",
    alignItems: "center",
    gap: "12px",
    padding: "15px",
    borderRadius: "20px",
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(226,232,240,0.95)",
    boxShadow: "0 16px 34px rgba(15, 23, 42, 0.07)",
  },

  missionIcon: {
    width: "44px",
    height: "44px",
    borderRadius: "15px",
    display: "grid",
    placeItems: "center",
    background: "linear-gradient(135deg, rgba(224, 186, 40, 0.18), rgba(22, 71, 119, 0.10))",
    fontSize: "22px",
  },

  missionLabel: {
    display: "block",
    color: "#64748b",
    fontSize: "11px",
    fontWeight: "950",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },

  missionValue: {
    display: "block",
    marginTop: "4px",
    color: "#07182c",
    fontSize: "18px",
    fontWeight: "950",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },

  missionNote: {
    display: "block",
    marginTop: "3px",
    color: "#64748b",
    fontSize: "12px",
    fontWeight: "800",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },

  executiveGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)",
    gap: "18px",
    marginBottom: "18px",
    alignItems: "stretch",
  },

  scorePanel: {
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(255,251,235,0.95))",
    borderRadius: "24px",
    padding: "20px",
    border: "1px solid rgba(224, 186, 40, 0.38)",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.09)",
    minWidth: 0,
  },

  scoreHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "14px",
    alignItems: "flex-start",
    flexWrap: "wrap",
    marginBottom: "16px",
  },

  scoreTitle: {
    margin: "4px 0 0",
    color: "#07182c",
    fontSize: "24px",
    fontWeight: "950",
  },

  scoreSubtitle: {
    margin: "6px 0 0",
    color: "#64748b",
    fontSize: "14px",
    lineHeight: 1.6,
    maxWidth: "760px",
  },

  scoreStatus: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid",
    borderRadius: "999px",
    padding: "8px 12px",
    fontSize: "12px",
    fontWeight: "950",
    whiteSpace: "nowrap",
  },

  scoreBody: {
    display: "grid",
    gridTemplateColumns: "180px minmax(0, 1fr)",
    gap: "18px",
    alignItems: "center",
  },

  scoreBodyMobile: {
    gridTemplateColumns: "1fr",
    placeItems: "center",
  },

  scoreRing: {
    width: "170px",
    height: "170px",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    boxShadow: "inset 0 0 0 1px rgba(15,23,42,0.08)",
  },

  scoreInner: {
    width: "112px",
    height: "112px",
    borderRadius: "50%",
    background: "#ffffff",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    boxShadow: "0 10px 24px rgba(15,23,42,0.12)",
  },

  bossBrief: {
    padding: "16px",
    borderRadius: "18px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
  },

  actionPlanPanel: {
    background: "#ffffff",
    borderRadius: "24px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
    minWidth: 0,
  },

  actionPlanList: {
    display: "grid",
    gap: "10px",
  },

  actionPlanItem: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    width: "100%",
    textAlign: "left",
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
    borderRadius: "16px",
    padding: "12px",
    cursor: "pointer",
    color: "#0f172a",
  },

  smartCenter: {
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(255,251,235,0.96))",
    borderRadius: "24px",
    padding: "20px",
    border: "1px solid rgba(224, 186, 40, 0.38)",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.09)",
    marginBottom: "18px",
  },

  smartCenterHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "14px",
    flexWrap: "wrap",
    marginBottom: "16px",
  },

  smartTitle: {
    margin: "4px 0 0",
    color: "#07182c",
    fontSize: "24px",
    fontWeight: "950",
  },

  smartSubtitle: {
    margin: "6px 0 0",
    color: "#64748b",
    fontSize: "14px",
    lineHeight: 1.6,
  },

  smartBadge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    padding: "8px 12px",
    background: "#07182c",
    color: "#e0ba28",
    fontWeight: "950",
    fontSize: "12px",
    whiteSpace: "nowrap",
  },

  smartGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "14px",
  },

  smartCard: {
    display: "flex",
    gap: "14px",
    alignItems: "flex-start",
    padding: "16px",
    borderRadius: "18px",
    border: "1px solid",
    minHeight: "150px",
  },

  smartCardMobile: {
    minHeight: "unset",
  },

  smartIcon: {
    width: "44px",
    height: "44px",
    borderRadius: "14px",
    background: "rgba(255,255,255,0.82)",
    display: "grid",
    placeItems: "center",
    fontSize: "24px",
    flexShrink: 0,
    boxShadow: "0 8px 20px rgba(15,23,42,0.08)",
  },

  smartBody: {
    display: "grid",
    gap: "8px",
  },

  smartActionButton: {
    justifySelf: "start",
    border: "none",
    background: "#07182c",
    color: "#ffffff",
    borderRadius: "12px",
    padding: "9px 12px",
    fontWeight: "900",
    cursor: "pointer",
  },

  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
    gap: "16px",
    marginBottom: "18px",
  },

  kpiCard: {
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.98))",
    borderRadius: "22px",
    padding: "18px",
    border: "1px solid rgba(226, 232, 240, 0.9)",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
    minHeight: "160px",
  },

  kpiTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "center",
  },

  kpiIcon: {
    width: "44px",
    height: "44px",
    display: "grid",
    placeItems: "center",
    borderRadius: "14px",
    fontSize: "22px",
  },

  trendPill: {
    padding: "6px 9px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: "900",
  },

  kpiLabel: {
    margin: "16px 0 0",
    color: "#64748b",
    fontSize: "12px",
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },

  kpiValue: {
    display: "block",
    marginTop: "8px",
    color: "#0f172a",
    fontSize: "24px",
    lineHeight: 1.15,
  },

  kpiNote: {
    display: "block",
    marginTop: "8px",
    color: "#64748b",
    fontSize: "13px",
  },

  bigGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.55fr) minmax(330px, 0.75fr)",
    gap: "18px",
    marginBottom: "18px",
    alignItems: "stretch",
  },

  midGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "18px",
    marginBottom: "18px",
  },

  bottomGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.4fr) minmax(330px, 0.8fr)",
    gap: "18px",
    alignItems: "start",
  },

  sideStack: {
    display: "grid",
    gap: "18px",
  },

  panel: {
    background: "#ffffff",
    borderRadius: "22px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
    minWidth: 0,
  },

  panelLarge: {
    background: "#ffffff",
    borderRadius: "22px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
    minWidth: 0,
  },

  panelHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "12px",
    marginBottom: "16px",
    flexWrap: "wrap",
  },

  panelTitle: {
    margin: 0,
    color: "#0f172a",
    fontSize: "20px",
    fontWeight: "950",
  },

  panelSubtitle: {
    margin: "5px 0 0",
    color: "#64748b",
    fontSize: "13px",
  },

  goldBadge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    padding: "7px 11px",
    background: "#fef3c7",
    color: "#92400e",
    fontWeight: "950",
    fontSize: "12px",
    whiteSpace: "nowrap",
  },

  chartBox: {
    width: "100%",
    overflowX: "auto",
    padding: "4px 0",
  },

  svgChart: {
    width: "100%",
    minWidth: "520px",
    height: "250px",
  },

  paymentCenter: {
    display: "grid",
    placeItems: "center",
    margin: "4px 0 16px",
  },

  donut: {
    width: "160px",
    height: "160px",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    boxShadow: "inset 0 0 0 1px rgba(15,23,42,0.08)",
  },

  donutInner: {
    width: "104px",
    height: "104px",
    borderRadius: "50%",
    background: "#ffffff",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    color: "#0f172a",
    boxShadow: "0 10px 24px rgba(15,23,42,0.12)",
  },

  paymentList: {
    display: "grid",
    gap: "10px",
  },

  paymentLine: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    alignItems: "center",
    fontSize: "13px",
    color: "#64748b",
    flexWrap: "wrap",
  },

  dot: {
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    display: "inline-block",
    marginRight: "8px",
  },

  progressTrack: {
    height: "16px",
    borderRadius: "999px",
    background: "#e2e8f0",
    overflow: "hidden",
  },

  progressFill: {
    height: "100%",
    borderRadius: "999px",
    background: "linear-gradient(90deg, #e0ba28, #22c55e)",
  },

  targetText: {
    margin: "14px 0 0",
    color: "#64748b",
    lineHeight: 1.6,
  },

  pulseGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "12px",
  },

  pulseItem: {
    display: "flex",
    gap: "10px",
    alignItems: "center",
    padding: "12px",
    borderRadius: "16px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  alertList: {
    display: "grid",
    gap: "10px",
  },

  alertItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "12px",
    borderRadius: "16px",
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    color: "#9a3412",
    flexWrap: "wrap",
  },

  tableWrap: {
    width: "100%",
    overflowX: "auto",
  },

  paymentBadge: {
    display: "inline-block",
    padding: "6px 9px",
    borderRadius: "999px",
    background: "#eff6ff",
    color: "#1d4ed8",
    fontWeight: "900",
    fontSize: "12px",
    textTransform: "capitalize",
  },

  badgeSuccess: {
    display: "inline-block",
    padding: "6px 9px",
    borderRadius: "999px",
    background: "#dcfce7",
    color: "#166534",
    fontWeight: "900",
    fontSize: "12px",
    textTransform: "capitalize",
  },

  badgeDanger: {
    display: "inline-block",
    padding: "6px 9px",
    borderRadius: "999px",
    background: "#fee2e2",
    color: "#991b1b",
    fontWeight: "900",
    fontSize: "12px",
    textTransform: "capitalize",
  },

  productList: {
    display: "grid",
    gap: "10px",
  },

  productItem: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    padding: "11px",
    borderRadius: "16px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  rank: {
    width: "30px",
    height: "30px",
    borderRadius: "50%",
    background: "#07182c",
    color: "#ffffff",
    display: "grid",
    placeItems: "center",
    fontWeight: "950",
    flexShrink: 0,
  },

  panelDark: {
    borderRadius: "22px",
    padding: "20px",
    background:
      "linear-gradient(135deg, #07182c 0%, #0d2f55 60%, #111827 100%)",
    color: "#ffffff",
    boxShadow: "0 18px 40px rgba(7, 24, 44, 0.22)",
    overflow: "hidden",
  },

  darkTitle: {
    margin: 0,
    color: "#e0ba28",
    fontSize: "20px",
    fontWeight: "950",
  },

  darkText: {
    color: "rgba(255,255,255,0.75)",
    lineHeight: 1.7,
  },

  darkMiniGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "10px",
    marginTop: "12px",
  },

  emptyState: {
    padding: "18px",
    borderRadius: "16px",
    background: "#f8fafc",
    color: "#64748b",
    border: "1px dashed #cbd5e1",
    textAlign: "center",
    fontWeight: "800",
  },
};