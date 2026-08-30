"use client";

import {
  ChangeEvent,
  useEffect,
  useMemo,
  useState,
} from "react";


import Papa from "papaparse";
import Encoding from "encoding-japanese";
import NaraMap from "./components/NaraMap";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type CsvRow = {
  [key: string]: string;
};

type Metric = "sales" | "purchase" | "profit" | "visitors";

const COLUMN = {
  slip: "伝票番号",
  date: "成約日時",
  weekday: "曜日",
  staff: "担当者",
  age: "年齢",
  visitType: "来店区分",
  address: "住所",
  sales: "入金予定金額",
  purchase: "買取金額",
  profit: "予定卸粗利",
  majorCategory: "大分類",
  middleCategory: "中分類",
};

const STORE_NAMES = [
  "桜井安倍木材団地店",
  "桜井粟殿店",
] as const;

const COLORS = [
  "#2563eb",
  "#0ea5e9",
  "#14b8a6",
  "#22c55e",
  "#84cc16",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
];

function parseNumber(value?: string) {
  if (!value) return 0;

  const cleaned = String(value)
    .replace(/,/g, "")
    .replace(/¥/g, "")
    .replace(/￥/g, "")
    .replace(/\s/g, "");

  const num = Number(cleaned);

  return Number.isFinite(num) ? num : 0;
}

function parseDate(value?: string) {
  if (!value) return null;

  const normalized = value.trim().replace(/-/g, "/").replace(/\./g, "/");
  const datePart = normalized.split(" ")[0];
  const parts = datePart.split("/").map(Number);

  if (parts.length < 3) return null;

  const [year, month, day] = parts;

  if (!year || !month || !day) return null;

  return {
    year,
    month,
    day,
    monthKey: `${year}-${String(month).padStart(2, "0")}`,
  };
}

function formatYen(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ja-JP").format(value);
}

function monthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${year}年${Number(month)}月`;
}

function previousMonth(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 2, 1);

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}`;
}

function comparison(current: number, previous: number) {
  if (previous === 0) {
    return current === 0 ? "―" : "比較なし";
  }

  const rate = ((current - previous) / previous) * 100;
  const sign = rate > 0 ? "+" : "";

  return `${sign}${rate.toFixed(1)}%`;
}

function shortenLabel(value: string, length = 10) {
  if (value.length <= length) return value;
  return `${value.slice(0, length)}…`;
}

function getAgeGroup(value?: string) {
  const age = Number(String(value ?? "").replace(/[^\d]/g, ""));

  if (!Number.isFinite(age) || age <= 0) {
    return "不明";
  }

  if (age < 20) return "20歳未満";
  if (age < 30) return "20代";
  if (age < 40) return "30代";
  if (age < 50) return "40代";
  if (age < 60) return "50代";
  if (age < 70) return "60代";

  return "70代以上";
}

function extractMunicipality(address?: string) {
  if (!address) return "住所不明";

  const value = address.trim();

  const match = value.match(
    /(?:東京都|北海道|(?:京都|大阪)府|.{2,3}県)?(.+?[市区町村郡])/
  );

  if (!match) {
    return "その他";
  }

  let municipality = match[1];

  // 郡の場合は、できればその後の町村まで取得
  if (municipality.endsWith("郡")) {
    const afterCounty = value.slice(
      value.indexOf(municipality) + municipality.length
    );

    const townMatch = afterCounty.match(/^(.+?[町村])/);

    if (townMatch) {
      municipality += townMatch[1];
    }
  }

  return municipality;
}

function extractTown(address?: string) {
  if (!address) return "住所不明";

  let value = address.trim();

  // 都道府県を削除
  value = value.replace(
    /^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/,
    ""
  );

  // 政令市などの「市＋区」を除去
  value = value.replace(/^(.+?市.+?区)/, "");

  // 郡＋町村を除去
  value = value.replace(/^(.+?郡.+?[町村])/, "");

  // 通常の市・区・町・村を除去
  value = value.replace(/^(.+?[市区町村])/, "");

  // 「大字」を除去
  value = value.replace(/^大字/, "");

  // 先頭の空白を除去
  value = value.trim();

  if (!value) return "町名不明";

  // 番地・丁目より前を町名として取得
  const match = value.match(
    /^(.+?)(?=\d+丁目|\d+番|\d+番地|\d+-|\d+ー|\d+$)/
  );

  if (match && match[1]) {
    return match[1]
      .replace(/[（(].*$/, "")
      .trim();
  }

  // 数字が出る位置までを町名として取得
  const simpleMatch = value.match(/^([^\d]+)/);

  if (simpleMatch && simpleMatch[1]) {
    return simpleMatch[1]
      .replace(/[（(].*$/, "")
      .trim();
  }

  return "町名不明";
}

export default function Home() {
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedRegionName, setSelectedRegionName] = useState("");
  const [metric, setMetric] = useState<Metric>("sales");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedTown, setSelectedTown] = useState<string | null>(null);
 const [importStore, setImportStore] =
  useState<(typeof STORE_NAMES)[number]>("桜井安倍木材団地店");

const [selectedStore, setSelectedStore] =
  useState<string>("全店舗");
  const [loadedFileKeys, setLoadedFileKeys] = useState<string[]>([]);

  useEffect(() => {
    console.log("自動CSV読込 useEffect 実行");
  const loadDefaultCsvFiles = async () => {
    try {
      setLoading(true);
      setError("");

      const csvFiles = [
        {
          path: "/data/sakurai-abe.csv",
          store: "桜井安倍木材団地店",
        },
        {
          path: "/data/sakurai-odono.csv",
          store: "桜井粟殿店",
        },
      ] as const;

      const allRows: CsvRow[] = [];

      for (const csvFile of csvFiles) {
        const response = await fetch(csvFile.path, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(
            `${csvFile.path} の読み込みに失敗しました。`
          );
        }

        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);

        const unicodeArray = Encoding.convert(bytes, {
          from: "SJIS",
          to: "UNICODE",
        });

        const text = Encoding.codeToString(unicodeArray);

        const parsedRows = await new Promise<CsvRow[]>(
          (resolve, reject) => {
            Papa.parse<CsvRow>(text, {
              header: true,
              skipEmptyLines: true,

              complete: (result) => {
                const cleanRows: CsvRow[] = result.data
                  .filter((row) =>
                    Object.values(row).some((value) =>
                      String(value ?? "").trim()
                    )
                  )
                  .map(
                    (row): CsvRow => ({
                      ...row,
                      店舗名: csvFile.store,
                    })
                  );

                resolve(cleanRows);
              },

              error: (error) => {
                reject(error);
              },
            });
          }
        );

        allRows.push(...parsedRows);
      }

      setRows(allRows);

      const loadedMonths = Array.from(
        new Set(
          allRows
            .map(
              (row) =>
                parseDate(row[COLUMN.date])?.monthKey
            )
            .filter(Boolean) as string[]
        )
      ).sort();

      if (loadedMonths.length > 0) {
        setSelectedMonth(
          loadedMonths[loadedMonths.length - 1]
        );
      }

      setFileName("保存済みCSVから自動読込");
      setLoading(false);
    } catch (error) {
      console.error(error);

      setError(
        "保存済みCSVの自動読み込みに失敗しました。"
      );

      setLoading(false);
    }
  };

  loadDefaultCsvFiles();
}, []);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) return;

    const fileKey = `${importStore}__${file.name}__${file.size}__${file.lastModified}`;

if (loadedFileKeys.includes(fileKey)) {
  setError(
    `${importStore}の同じCSVファイルはすでに読み込まれています。`
  );

  event.target.value = "";
  return;
}

    setLoading(true);
    setError("");
    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      const unicodeArray = Encoding.convert(bytes, {
        from: "SJIS",
        to: "UNICODE",
      });

      const text = Encoding.codeToString(unicodeArray);

      Papa.parse<CsvRow>(text, {
        header: true,
        skipEmptyLines: true,

        complete: (result) => {
          const cleanRows: CsvRow[] = result.data
  .filter((row) =>
    Object.values(row).some((value) => String(value ?? "").trim())
  )
  .map(
    (row): CsvRow => ({
      ...row,
      店舗名: importStore,
    })
  );

          if (cleanRows.length === 0) {
            setError("CSVにデータがありません。");
            setLoading(false);
            return;
          }

          const firstRow = cleanRows[0];

          const requiredColumns = [
            COLUMN.slip,
            COLUMN.date,
            COLUMN.sales,
            COLUMN.purchase,
            COLUMN.profit,
          ];

          const missingColumns = requiredColumns.filter(
            (column) => !(column in firstRow)
          );

          if (missingColumns.length > 0) {
            setError(
              `必要な列が見つかりません：${missingColumns.join("、")}`
            );
            setLoading(false);
            return;
          }

          setRows((prevRows) => [...prevRows, ...cleanRows]);
          setLoadedFileKeys((prev) => [...prev, fileKey]);

          const months = Array.from(
            new Set(
              cleanRows
                .map((row) => parseDate(row[COLUMN.date])?.monthKey)
                .filter(Boolean) as string[]
            )
          ).sort();

          if (months.length > 0) {
            setSelectedMonth(months[months.length - 1]);
          }

          setLoading(false);
        },

        error: () => {
          setError("CSVの読み込みに失敗しました。");
          setLoading(false);
        },
      });
    } catch (err) {
      console.error(err);
      setError("CSVの読み込み中にエラーが発生しました。");
      setLoading(false);
    }
  };

    
  const months = useMemo(() => {
    return Array.from(
      new Set(
        rows
          .map((row) => parseDate(row[COLUMN.date])?.monthKey)
          .filter(Boolean) as string[]
      )
    ).sort();
  }, [rows]);

　　const storeLoadSummary = STORE_NAMES.map((store) => {
  const count = rows.filter(
    (row) => String(row["店舗名"] ?? "").trim() === store
  ).length;

  return {
    store,
    count,
  };
});

  const filteredRows = useMemo(() => {
  if (!selectedMonth) return [];

  return rows.filter((row) => {
    const monthMatch =
      parseDate(row[COLUMN.date])?.monthKey === selectedMonth;

    const storeMatch =
      selectedStore === "全店舗" ||
      String(row["店舗名"] ?? "").trim() === selectedStore;

    return monthMatch && storeMatch;
  });
}, [rows, selectedMonth, selectedStore]);

  const townFilteredRows = useMemo(() => {
  if (!selectedTown) {
    return filteredRows;
  }

  return filteredRows.filter((row) => {
    const municipality = extractMunicipality(row[COLUMN.address]);
    const town = extractTown(row[COLUMN.address]);

    const townName =
      town === "町名不明" || town === "住所不明"
        ? `${municipality} その他`
        : `${municipality} ${town}`;

    return townName === selectedTown;
  });
}, [filteredRows, selectedTown]);

  const previousRows = useMemo(() => {
  if (!selectedMonth) return [];

  const prev = previousMonth(selectedMonth);

  return rows.filter((row) => {
    const monthMatch =
      parseDate(row[COLUMN.date])?.monthKey === prev;

    const storeMatch =
      selectedStore === "全店舗" ||
      String(row["店舗名"] ?? "").trim() === selectedStore;

    return monthMatch && storeMatch;
  });
}, [rows, selectedMonth, selectedStore]);

const previousTownFilteredRows = useMemo(() => {
  if (!selectedTown) {
    return previousRows;
  }

  return previousRows.filter((row) => {
    const municipality = extractMunicipality(row[COLUMN.address]);
    const town = extractTown(row[COLUMN.address]);

    const townName =
      town === "町名不明" || town === "住所不明"
        ? `${municipality} その他`
        : `${municipality} ${town}`;

    return townName === selectedTown;
  });
}, [previousRows, selectedTown]);

  const calculateKpis = (data: CsvRow[]) => {
    const slips = new Set(
      data
        .map((row) => String(row[COLUMN.slip] ?? "").trim())
        .filter(Boolean)
    );

    const sales = data.reduce(
      (sum, row) => sum + parseNumber(row[COLUMN.sales]),
      0
    );

    const purchase = data.reduce(
      (sum, row) => sum + parseNumber(row[COLUMN.purchase]),
      0
    );

    const profit = data.reduce(
      (sum, row) => sum + parseNumber(row[COLUMN.profit]),
      0
    );

    return {
      visitors: slips.size,
      sales,
      purchase,
      profit,
    };
  };

  const currentKpi = useMemo(
  () => calculateKpis(townFilteredRows),
  [townFilteredRows]
);

const previousKpi = useMemo(
  () => calculateKpis(previousTownFilteredRows),
  [previousTownFilteredRows]
);

const storeComparisonData = useMemo(() => {
  return STORE_NAMES.map((store) => {
    let storeRows = rows.filter((row) => {
      const monthMatch =
        parseDate(row[COLUMN.date])?.monthKey === selectedMonth;

      const storeMatch =
        String(row["店舗名"] ?? "").trim() === store;

      return monthMatch && storeMatch;
    });

    if (selectedTown) {
      storeRows = storeRows.filter((row) => {
        const municipality = extractMunicipality(row[COLUMN.address]);
        const town = extractTown(row[COLUMN.address]);

        const townName =
          town === "町名不明" || town === "住所不明"
            ? `${municipality} その他`
            : `${municipality} ${town}`;

        return townName === selectedTown;
      });
    }

    const kpi = calculateKpis(storeRows);

const profitRate =
  kpi.sales > 0
    ? (kpi.profit / kpi.sales) * 100
    : 0;

const averageSales =
  kpi.visitors > 0
    ? kpi.sales / kpi.visitors
    : 0;

return {
  store,
  ...kpi,
  profitRate,
  averageSales,
};
  });
}, [rows, selectedMonth, selectedTown]);

  const dailyData = useMemo(() => {
    if (!selectedMonth) return [];

    const [year, month] = selectedMonth.split("-").map(Number);
    const lastDay = new Date(year, month, 0).getDate();

    const days = Array.from({ length: lastDay }, (_, index) => ({
      day: index + 1,
      sales: 0,
      purchase: 0,
      profit: 0,
      slips: new Set<string>(),
    }));

    townFilteredRows.forEach((row) => {
      const parsed = parseDate(row[COLUMN.date]);

      if (!parsed) return;

      const target = days[parsed.day - 1];

      if (!target) return;

      target.sales += parseNumber(row[COLUMN.sales]);
      target.purchase += parseNumber(row[COLUMN.purchase]);
      target.profit += parseNumber(row[COLUMN.profit]);

      const slip = String(row[COLUMN.slip] ?? "").trim();

      if (slip) {
        target.slips.add(slip);
      }
    });

    return days.map((day) => ({
      day: `${day.day}日`,
      sales: day.sales,
      purchase: day.purchase,
      profit: day.profit,
      visitors: day.slips.size,
    }));
  }, [townFilteredRows, selectedMonth]);

  const majorCategoryData = useMemo(() => {
    const map = new Map<string, number>();

    townFilteredRows.forEach((row) => {
      const category =
        String(row[COLUMN.majorCategory] ?? "").trim() || "未分類";

      map.set(
        category,
        (map.get(category) ?? 0) + parseNumber(row[COLUMN.purchase])
      );
    });

    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [townFilteredRows]);


  const middleCategoryData = useMemo(() => {
    const map = new Map<string, number>();

    townFilteredRows.forEach((row) => {
      const category =
        String(row[COLUMN.middleCategory] ?? "").trim() || "未分類";

      map.set(
        category,
        (map.get(category) ?? 0) + parseNumber(row[COLUMN.purchase])
      );
    });

    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [townFilteredRows]);

  const weekdayData = useMemo(() => {
    const order = ["月", "火", "水", "木", "金", "土", "日"];

    const map = new Map<
      string,
      {
        slips: Set<string>;
        sales: number;
      }
    >();

    order.forEach((day) => {
      map.set(day, {
        slips: new Set<string>(),
        sales: 0,
      });
    });

    townFilteredRows.forEach((row) => {
      let weekday = String(row[COLUMN.weekday] ?? "").trim();

      weekday = weekday
        .replace("曜日", "")
        .replace("(", "")
        .replace(")", "")
        .replace("（", "")
        .replace("）", "");

      if (!map.has(weekday)) return;

      const target = map.get(weekday)!;
      const slip = String(row[COLUMN.slip] ?? "").trim();

      if (slip) {
        target.slips.add(slip);
      }

      target.sales += parseNumber(row[COLUMN.sales]);
    });

    return order.map((day) => ({
      weekday: day,
      visitors: map.get(day)?.slips.size ?? 0,
      sales: map.get(day)?.sales ?? 0,
    }));
  }, [townFilteredRows]);


  const staffData = useMemo(() => {
    const map = new Map<
      string,
      {
        sales: number;
        profit: number;
        slips: Set<string>;
      }
    >();

    townFilteredRows.forEach((row) => {
      const staff = String(row[COLUMN.staff] ?? "").trim() || "未設定";

      if (!map.has(staff)) {
        map.set(staff, {
          sales: 0,
          profit: 0,
          slips: new Set<string>(),
        });
      }

      const target = map.get(staff)!;

      target.sales += parseNumber(row[COLUMN.sales]);
      target.profit += parseNumber(row[COLUMN.profit]);

      const slip = String(row[COLUMN.slip] ?? "").trim();

      if (slip) {
        target.slips.add(slip);
      }
    });

    return Array.from(map.entries())
      .map(([name, value]) => ({
        name,
        sales: value.sales,
        profit: value.profit,
        visitors: value.slips.size,
      }))
      .sort((a, b) => b.sales - a.sales);
  }, [townFilteredRows]);

  const ageData = useMemo(() => {
    const order = [
      "20歳未満",
      "20代",
      "30代",
      "40代",
      "50代",
      "60代",
      "70代以上",
      "不明",
    ];

    const map = new Map<string, Set<string>>();

    order.forEach((group) => {
      map.set(group, new Set<string>());
    });

    townFilteredRows.forEach((row) => {
      const group = getAgeGroup(row[COLUMN.age]);
      const slip = String(row[COLUMN.slip] ?? "").trim();

      if (slip) {
        map.get(group)?.add(slip);
      }
    });

    return order
      .map((name) => ({
        name,
        value: map.get(name)?.size ?? 0,
      }))
      .filter((item) => item.value > 0);
  }, [townFilteredRows]);

  const visitTypeData = useMemo(() => {
    const map = new Map<string, Set<string>>();

    townFilteredRows.forEach((row) => {
      const type = String(row[COLUMN.visitType] ?? "").trim() || "未設定";
      const slip = String(row[COLUMN.slip] ?? "").trim();

      if (!map.has(type)) {
        map.set(type, new Set<string>());
      }

      if (slip) {
        map.get(type)?.add(slip);
      }
    });

    return Array.from(map.entries())
      .map(([name, slips]) => ({
        name,
        value: slips.size,
      }))
      .sort((a, b) => b.value - a.value);
  }, [townFilteredRows]);
  
  const regionData = useMemo(() => {
  const map = new Map<
    string,
    {
      slips: Set<string>;
      sales: number;
      purchase: number;
      profit: number;
    }
  >();
 
  filteredRows.forEach((row) => {
    const region = extractMunicipality(row[COLUMN.address]);

    if (!map.has(region)) {
      map.set(region, {
        slips: new Set<string>(),
        sales: 0,
        purchase: 0,
        profit: 0,
      });
    }

    const target = map.get(region)!;

    const slip = String(row[COLUMN.slip] ?? "").trim();

    if (slip) {
      target.slips.add(slip);
    }

    target.sales += parseNumber(row[COLUMN.sales]);
    target.purchase += parseNumber(row[COLUMN.purchase]);
    target.profit += parseNumber(row[COLUMN.profit]);
  });

  return Array.from(map.entries())
    .map(([name, value]) => ({
      name,
      visitors: value.slips.size,
      sales: value.sales,
      purchase: value.purchase,
      profit: value.profit,
    }))
    .sort((a, b) => b.visitors - a.visitors);
}, [filteredRows]);
  
const regionComparisonData = useMemo(() => {
  const map = new Map<
    string,
    {
      store1Slips: Set<string>;
      store2Slips: Set<string>;
    }
  >();

  rows.forEach((row) => {
    const parsed = parseDate(row[COLUMN.date]);

    if (!parsed || parsed.monthKey !== selectedMonth) {
      return;
    }

    const region = extractMunicipality(row[COLUMN.address]);
    const store = String(row["店舗名"] ?? "").trim();
    const slip = String(row[COLUMN.slip] ?? "").trim();

    if (!map.has(region)) {
      map.set(region, {
        store1Slips: new Set<string>(),
        store2Slips: new Set<string>(),
      });
    }

    if (!slip) return;

    const target = map.get(region)!;

    if (store === STORE_NAMES[0]) {
      target.store1Slips.add(slip);
    }

    if (store === STORE_NAMES[1]) {
      target.store2Slips.add(slip);
    }
  });

  return Array.from(map.entries())
    .map(([name, value]) => ({
      name,
      store1: value.store1Slips.size,
      store2: value.store2Slips.size,
      total:
        value.store1Slips.size +
        value.store2Slips.size,
    }))
    .sort((a, b) => b.total - a.total);
}, [rows, selectedMonth]);

const townComparisonData = useMemo(() => {
  if (!selectedRegionName) {
    return [];
  }

  const map = new Map<
    string,
    {
      store1Slips: Set<string>;
      store2Slips: Set<string>;
    }
  >();

  rows.forEach((row) => {
    const parsed = parseDate(row[COLUMN.date]);

    if (!parsed || parsed.monthKey !== selectedMonth) {
      return;
    }

    const municipality = extractMunicipality(row[COLUMN.address]);

    if (municipality !== selectedRegionName) {
      return;
    }

    const town = extractTown(row[COLUMN.address]);

    const townName =
      town === "町名不明" || town === "住所不明"
        ? `${municipality} その他`
        : `${municipality} ${town}`;

    const store = String(row["店舗名"] ?? "").trim();
    const slip = String(row[COLUMN.slip] ?? "").trim();

    if (!map.has(townName)) {
      map.set(townName, {
        store1Slips: new Set<string>(),
        store2Slips: new Set<string>(),
      });
    }

    if (!slip) return;

    const target = map.get(townName)!;

    if (store === STORE_NAMES[0]) {
      target.store1Slips.add(slip);
    }

    if (store === STORE_NAMES[1]) {
      target.store2Slips.add(slip);
    }
  });

  return Array.from(map.entries())
    .map(([name, value]) => ({
      name,
      store1: value.store1Slips.size,
      store2: value.store2Slips.size,
      total:
        value.store1Slips.size +
        value.store2Slips.size,
    }))
    .sort((a, b) => b.total - a.total);
}, [rows, selectedMonth, selectedRegionName]);

   const townData = useMemo(() => {
  const map = new Map<
    string,
    {
      slips: Set<string>;
      sales: number;
      purchase: number;
      profit: number;
    }
  >();

  filteredRows.forEach((row) => {
    const municipality = extractMunicipality(
      row[COLUMN.address]
    );

    const town = extractTown(row[COLUMN.address]);

    const name =
      town === "町名不明" || town === "住所不明"
        ? `${municipality} その他`
        : `${municipality} ${town}`;

    if (!map.has(name)) {
      map.set(name, {
        slips: new Set<string>(),
        sales: 0,
        purchase: 0,
        profit: 0,
      });
    }

    const target = map.get(name)!;

    const slip = String(row[COLUMN.slip] ?? "").trim();

    if (slip) {
      target.slips.add(slip);
    }

    target.sales += parseNumber(row[COLUMN.sales]);
    target.purchase += parseNumber(row[COLUMN.purchase]);
    target.profit += parseNumber(row[COLUMN.profit]);
  });

  return Array.from(map.entries())
    .map(([name, value]) => ({
      name,
      visitors: value.slips.size,
      sales: value.sales,
      purchase: value.purchase,
      profit: value.profit,
    }))
    .sort((a, b) => b.visitors - a.visitors);
}, [filteredRows]);

const filteredTownData = useMemo(() => {
  if (!selectedRegionName) {
    return townData;
  }

  return townData.filter((item) =>
    item.name.startsWith(`${selectedRegionName} `)
  );
}, [townData, selectedRegionName]);

  const metricInfo = {
    sales: { label: "売上" },
    purchase: { label: "買取金額" },
    profit: { label: "粗利" },
    visitors: { label: "来店数" },
  };

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto max-w-[1600px] p-4 md:p-6 lg:p-8">
        <header className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="mb-1 text-sm font-semibold text-blue-600">
                BUSINESS INTELLIGENCE
              </p>

              <h1 className="text-2xl font-bold md:text-3xl">
                買取店舗 BI Dashboard
              </h1>

              <p className="mt-2 text-sm text-slate-500">
                CSVから売上・買取・粗利・来店実績を自動集計します
              </p>
            </div>

           <div className="flex flex-col gap-4">

  {/* 表示条件 */}
  <div>
    <div className="mb-2 text-sm font-bold text-slate-700">
      表示条件
    </div>

    <div className="flex flex-wrap items-end gap-3">
      {/* 表示店舗 */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-slate-500">
          表示店舗
        </span>

        <select
          value={selectedStore}
          onChange={(e) => {
            setSelectedStore(e.target.value);
            setSelectedTown(null);
            setSelectedRegionName("");
          }}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-blue-500"
        >
          <option value="全店舗">全店舗</option>

          {STORE_NAMES.map((store) => (
            <option key={store} value={store}>
              {store}
            </option>
          ))}
        </select>
      </div>

      {/* 対象月 */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-slate-500">
          対象月
        </span>

        <select
          value={selectedMonth}
          onChange={(e) => {
            setSelectedMonth(e.target.value);
            setSelectedTown(null);
            setSelectedRegionName("");
          }}
          disabled={months.length === 0}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-blue-500 disabled:bg-slate-100"
        >
          {months.length === 0 && <option>対象月</option>}

          {months.map((month) => (
            <option key={month} value={month}>
              {monthLabel(month)}
            </option>
          ))}
        </select>
      </div>
    </div>
  </div>

  {/* CSVデータ管理 */}
  <div>
    <div className="mb-2 text-sm font-bold text-slate-700">
  CSVデータ管理
</div>
    

    <div className="flex flex-wrap items-end gap-3">
      {/* CSV登録店舗 */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-slate-500">
          CSV登録店舗
        </span>

        <select
          value={importStore}
          onChange={(e) =>
            setImportStore(
              e.target.value as (typeof STORE_NAMES)[number]
            )
          }
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-blue-500"
        >
          {STORE_NAMES.map((store) => (
            <option key={store} value={store}>
              {store}
            </option>
          ))}
        </select>
      </div>

      {/* CSV読込 */}
      <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white transition hover:bg-blue-700">
        CSVを読み込む

        <input
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="hidden"
        />
      </label>

      {/* リセット */}
      <button
        type="button"
        onClick={() => {
          setRows([]);
          setLoadedFileKeys([]);
          setFileName("");
          setSelectedMonth("");
          setSelectedStore("全店舗");
          setSelectedTown(null);
          setSelectedRegionName("");
          setSelectedCity(null);
          setError("");
        }}
        className="min-h-11 rounded-xl border border-red-200 bg-red-50 px-5 py-3 font-semibold text-red-600 transition hover:bg-red-100"
      >
        読込データをクリア
      </button>
    </div>
  </div>

</div>
          </div>

          {fileName && (
  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
    <span className="mr-2 font-semibold text-slate-700">
      最後に読み込んだファイル
    </span>

    <span>{fileName}</span>
  </div>
)}
　　　　　　{rows.length > 0 && (
  <div className="mt-3">
    <div className="mb-2 text-xs font-bold text-slate-500">
      読み込み済みデータ
    </div>

    <div className="flex flex-wrap gap-3">
      {storeLoadSummary.map((item) => (
        <div
          key={item.store}
          className="flex min-w-[260px] items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3"
        >
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  item.count > 0
                    ? "bg-emerald-500"
                    : "bg-slate-300"
                }`}
              />

              <span className="font-semibold text-slate-700">
                {item.store}
              </span>
            </div>

            <div className="mt-1 text-xs text-slate-500">
              {item.count > 0 ? "読込済み" : "未読込"}
            </div>
          </div>

          <div className="text-right">
            <div className="text-lg font-bold text-slate-900">
              {formatNumber(item.count)}
            </div>

            <div className="text-xs text-slate-500">
              行
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
)}


          {loading && (
            <div className="mt-4 text-sm font-semibold text-blue-600">
              CSVを読み込んでいます...
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}
        </header>

        {rows.length === 0 ? (
          <section className="flex min-h-[420px] items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-center">
            <div>
              <div className="mb-4 text-5xl">📊</div>

              <h2 className="text-xl font-bold">CSVを読み込んでください</h2>

              <p className="mt-2 text-slate-500">
                上の「CSVを読み込む」からCSVファイルを選択します。
              </p>
            </div>
          </section>
        ) : (
          <>
          {selectedTown && (
  <section className="mb-4 flex flex-col gap-4 rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
  <div>
    <div className="mb-2 text-xs font-bold text-blue-600">
      現在の表示条件
    </div>

    <div className="flex flex-wrap gap-x-8 gap-y-3">
      <div>
        <div className="text-xs text-slate-500">
          店舗
        </div>

        <div className="mt-1 font-bold text-slate-900">
          {selectedStore}
        </div>
      </div>

      <div>
        <div className="text-xs text-slate-500">
          対象月
        </div>

        <div className="mt-1 font-bold text-slate-900">
          {selectedMonth ? monthLabel(selectedMonth) : "未選択"}
        </div>
      </div>

      {selectedTown && (
        <div>
          <div className="text-xs text-slate-500">
            町名
          </div>

          <div className="mt-1 font-bold text-slate-900">
            {selectedTown}
          </div>
        </div>
      )}
    </div>
  </div>

  {selectedTown && (
    <button
      type="button"
      onClick={() => setSelectedTown(null)}
      className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
    >
      × 町名フィルターを解除
    </button>
  )}
</section>
)}
            <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                title="来店数"
                value={`${formatNumber(currentKpi.visitors)}件`}
                comparison={comparison(
                  currentKpi.visitors,
                  previousKpi.visitors
                )}
              />

              <KpiCard
                title="売上"
                value={formatYen(currentKpi.sales)}
                comparison={comparison(
                  currentKpi.sales,
                  previousKpi.sales
                )}
              />

              <KpiCard
                title="買取金額"
                value={formatYen(currentKpi.purchase)}
                comparison={comparison(
                  currentKpi.purchase,
                  previousKpi.purchase
                )}
              />

              <KpiCard
                title="粗利"
                value={formatYen(currentKpi.profit)}
                comparison={comparison(
                  currentKpi.profit,
                  previousKpi.profit
                )}
              />
            </section>

            <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
              <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-xl font-bold">日別推移</h2>

                  <p className="mt-1 text-sm text-slate-500">
                    {monthLabel(selectedMonth)}の日別実績
                  </p>
                </div>

<section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
  <div className="mb-5">
    <div className="text-xs font-bold text-blue-600">
      STORE COMPARISON
    </div>

    <h2 className="mt-1 text-xl font-bold">
      店舗比較
    </h2>

    <p className="mt-1 text-sm text-slate-500">
      {selectedMonth ? monthLabel(selectedMonth) : "対象月未選択"}
      {selectedTown ? `・${selectedTown}` : ""}
    </p>
  </div>

  <div className="overflow-x-auto">
    <table className="w-full min-w-[700px] border-collapse">
      <thead>
        <tr>
          <th className="border-b border-slate-200 px-4 py-3 text-left text-sm font-semibold text-slate-500">
            指標
          </th>

          {storeComparisonData.map((item) => (
            <th
              key={item.store}
              className="border-b border-slate-200 px-4 py-3 text-right text-sm font-bold text-slate-700"
            >
              {item.store}
            </th>
          ))}
          <th className="border-b border-slate-200 px-4 py-3 text-right text-sm font-bold text-blue-600">
  差
</th>
        </tr>
      </thead>

      <tbody>
        <tr>
          <td className="border-b border-slate-100 px-4 py-4 font-semibold text-slate-600">
            来店数
          </td>

          {storeComparisonData.map((item) => (
            <td
              key={item.store}
              className="border-b border-slate-100 px-4 py-4 text-right text-lg font-bold"
            >
              {formatNumber(item.visitors)}件
            </td>
          ))}
          <td className="border-b border-slate-100 px-4 py-4 text-right text-lg font-bold text-blue-600">
  {storeComparisonData.length >= 2
    ? `${
        storeComparisonData[0].visitors - storeComparisonData[1].visitors >= 0
          ? "+"
          : ""
      }${formatNumber(
        storeComparisonData[0].visitors -
          storeComparisonData[1].visitors
      )}件`
    : "-"}
</td>
        </tr>

        <tr>
          <td className="border-b border-slate-100 px-4 py-4 font-semibold text-slate-600">
            売上
          </td>

          {storeComparisonData.map((item) => (
            <td
              key={item.store}
              className="border-b border-slate-100 px-4 py-4 text-right text-lg font-bold"
            >
              {formatYen(item.sales)}
            </td>
          ))}

          <td className="border-b border-slate-100 px-4 py-4 text-right text-lg font-bold text-blue-600">
  {storeComparisonData.length >= 2
    ? `${
        storeComparisonData[0].sales - storeComparisonData[1].sales >= 0
          ? "+"
          : ""
      }${formatYen(
        storeComparisonData[0].sales -
          storeComparisonData[1].sales
      )}`
    : "-"}
</td>
        </tr>

        <tr>
          <td className="border-b border-slate-100 px-4 py-4 font-semibold text-slate-600">
            買取金額
          </td>

          {storeComparisonData.map((item) => (
            <td
              key={item.store}
              className="border-b border-slate-100 px-4 py-4 text-right text-lg font-bold"
            >
              {formatYen(item.purchase)}
            </td>
          ))}

          <td className="border-b border-slate-100 px-4 py-4 text-right text-lg font-bold text-blue-600">
  {storeComparisonData.length >= 2
    ? `${
        storeComparisonData[0].purchase -
          storeComparisonData[1].purchase >=
        0
          ? "+"
          : ""
      }${formatYen(
        storeComparisonData[0].purchase -
          storeComparisonData[1].purchase
      )}`
    : "-"}
</td>
        </tr>

        <tr>
          <td className="px-4 py-4 font-semibold text-slate-600">
            粗利
          </td>

          {storeComparisonData.map((item) => (
            <td
              key={item.store}
              className="px-4 py-4 text-right text-lg font-bold"
            >
              {formatYen(item.profit)}
            </td>
          ))}

          <td className="px-4 py-4 text-right text-lg font-bold text-blue-600">
  {storeComparisonData.length >= 2
    ? `${
        storeComparisonData[0].profit - storeComparisonData[1].profit >= 0
          ? "+"
          : ""
      }${formatYen(
        storeComparisonData[0].profit -
          storeComparisonData[1].profit
      )}`
    : "-"}
</td>
        </tr>
        <tr>
  <td className="border-t border-slate-100 px-4 py-4 font-semibold text-slate-600">
    粗利率
  </td>

  {storeComparisonData.map((item) => (
    <td
      key={item.store}
      className="border-t border-slate-100 px-4 py-4 text-right text-lg font-bold"
    >
      {item.profitRate.toFixed(1)}%
    </td>
  ))}

  <td className="border-t border-slate-100 px-4 py-4 text-right text-lg font-bold text-blue-600">
    {storeComparisonData.length >= 2
      ? `${
          storeComparisonData[0].profitRate -
            storeComparisonData[1].profitRate >=
          0
            ? "+"
            : ""
        }${(
          storeComparisonData[0].profitRate -
          storeComparisonData[1].profitRate
        ).toFixed(1)}pt`
      : "-"}
  </td>
</tr>
<tr>
  <td className="px-4 py-4 font-semibold text-slate-600">
    客単価
  </td>

  {storeComparisonData.map((item) => (
    <td
      key={item.store}
      className="px-4 py-4 text-right text-lg font-bold"
    >
      {formatYen(item.averageSales)}
    </td>
  ))}

  <td className="px-4 py-4 text-right text-lg font-bold text-blue-600">
    {storeComparisonData.length >= 2
      ? `${
          storeComparisonData[0].averageSales -
            storeComparisonData[1].averageSales >=
          0
            ? "+"
            : ""
        }${formatYen(
          storeComparisonData[0].averageSales -
            storeComparisonData[1].averageSales
        )}`
      : "-"}
  </td>
</tr>

      </tbody>
    </table>
  </div>
</section>


                <div className="flex flex-wrap gap-2">
                  {(Object.keys(metricInfo) as Metric[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setMetric(key)}
                      className={`min-h-10 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                        metric === key
                          ? "bg-blue-600 text-white"
                          : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {metricInfo[key].label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-[380px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={dailyData}
                    margin={{
                      top: 10,
                      right: 20,
                      left: 10,
                      bottom: 0,
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />

                    <XAxis dataKey="day" tick={{ fontSize: 12 }} />

                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => {
                        if (metric === "visitors") return `${value}`;

                        if (value >= 1000000) {
                          return `${(value / 1000000).toFixed(1)}M`;
                        }

                        if (value >= 1000) {
                          return `${Math.round(value / 1000)}k`;
                        }

                        return `${value}`;
                      }}
                    />

                    <Tooltip
                      formatter={(value) => {
                        const num = Number(value ?? 0);

                        if (metric === "visitors") {
                          return [
                            `${formatNumber(num)}件`,
                            metricInfo[metric].label,
                          ];
                        }

                        return [
                          formatYen(num),
                          metricInfo[metric].label,
                        ];
                      }}
                    />

                    <Line
                      type="monotone"
                      dataKey={metric}
                      name={metricInfo[metric].label}
                      stroke="#2563eb"
                      strokeWidth={3}
                      dot={{ r: 3 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
              <ChartCard title="大分類" subtitle="買取金額ベース">
                <div className="h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={majorCategoryData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={70}
                        outerRadius={115}
                        paddingAngle={2}
                      >
                        {majorCategoryData.map((_, index) => (
                          <Cell
                            key={index}
                            fill={COLORS[index % COLORS.length]}
                          />
                        ))}
                      </Pie>

                      <Tooltip
                        formatter={(value) => [
                          formatYen(Number(value ?? 0)),
                          "買取金額",
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <LegendList
                  data={majorCategoryData.slice(0, 6)}
                  currency
                />
              </ChartCard>

              <ChartCard
                title="中分類 TOP10"
                subtitle="買取金額ランキング"
              >
                <div className="h-[440px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={middleCategoryData}
                      layout="vertical"
                      margin={{
                        top: 10,
                        right: 20,
                        left: 20,
                        bottom: 10,
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />

                      <XAxis
                        type="number"
                        tickFormatter={(value) => {
                          if (value >= 1000000) {
                            return `${(value / 1000000).toFixed(1)}M`;
                          }

                          if (value >= 1000) {
                            return `${Math.round(value / 1000)}k`;
                          }

                          return `${value}`;
                        }}
                      />

                      <YAxis
                        type="category"
                        dataKey="name"
                        width={105}
                        tickFormatter={(value) => shortenLabel(value, 8)}
                        tick={{ fontSize: 12 }}
                      />

                      <Tooltip
                        formatter={(value) => [
                          formatYen(Number(value ?? 0)),
                          "買取金額",
                        ]}
                      />

                      <Bar
                        dataKey="value"
                        fill="#2563eb"
                        radius={[0, 6, 6, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>

              <ChartCard title="曜日別" subtitle="来店数">
                <div className="h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={weekdayData}
                      margin={{
                        top: 10,
                        right: 10,
                        left: 0,
                        bottom: 10,
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />

                      <XAxis dataKey="weekday" />

                      <YAxis allowDecimals={false} />

                      <Tooltip
                        formatter={(value) => [
                          `${formatNumber(Number(value ?? 0))}件`,
                          "来店数",
                        ]}
                      />

                      <Bar
                        dataKey="visitors"
                        fill="#0ea5e9"
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  {weekdayData.map((item) => (
                    <div
                      key={item.weekday}
                      className="rounded-xl bg-slate-50 px-4 py-3"
                    >
                      <div className="text-xs font-semibold text-slate-500">
                        {item.weekday}曜日
                      </div>

                      <div className="mt-1 text-lg font-bold">
                        {item.visitors}件
                      </div>
                    </div>
                  ))}
                </div>
              </ChartCard>
            </section>

            <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
              <ChartCard
                title="担当者別"
                subtitle="売上ランキング"
              >
                <div className="h-[420px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={staffData}
                      layout="vertical"
                      margin={{
                        top: 10,
                        right: 20,
                        left: 30,
                        bottom: 10,
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />

                      <XAxis
                        type="number"
                        tickFormatter={(value) => {
                          if (value >= 1000000) {
                            return `${(value / 1000000).toFixed(1)}M`;
                          }

                          if (value >= 1000) {
                            return `${Math.round(value / 1000)}k`;
                          }

                          return `${value}`;
                        }}
                      />

                      <YAxis
                        type="category"
                        dataKey="name"
                        width={100}
                        tick={{ fontSize: 12 }}
                      />

                      <Tooltip
                        formatter={(value) => [
                          formatYen(Number(value ?? 0)),
                          "売上",
                        ]}
                      />

                      <Bar
                        dataKey="sales"
                        fill="#2563eb"
                        radius={[0, 6, 6, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-3 space-y-2">
                  {staffData.slice(0, 5).map((item, index) => (
                    <div
                      key={item.name}
                      className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"
                    >
                      <div>
                        <span className="mr-2 text-sm font-bold text-blue-600">
                          {index + 1}
                        </span>

                        <span className="font-semibold">{item.name}</span>
                      </div>

                      <div className="text-right">
                        <div className="font-bold">
                          {formatYen(item.sales)}
                        </div>

                        <div className="text-xs text-slate-500">
                          来店 {item.visitors}件
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ChartCard>

              <ChartCard
                title="年齢層"
                subtitle="伝票番号ベースの来店数"
              >
                <div className="h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={ageData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={70}
                        outerRadius={115}
                        paddingAngle={2}
                      >
                        {ageData.map((_, index) => (
                          <Cell
                            key={index}
                            fill={COLORS[index % COLORS.length]}
                          />
                        ))}
                      </Pie>

                      <Tooltip
                        formatter={(value) => [
                          `${formatNumber(Number(value ?? 0))}件`,
                          "来店数",
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <LegendList data={ageData} />
              </ChartCard>

              <ChartCard
                title="来店区分"
                subtitle="新規・リピーターなど"
              >
                <div className="h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={visitTypeData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={115}
                        paddingAngle={3}
                      >
                        {visitTypeData.map((_, index) => (
                          <Cell
                            key={index}
                            fill={COLORS[index % COLORS.length]}
                          />
                        ))}
                      </Pie>

                      <Tooltip
                        formatter={(value) => [
                          `${formatNumber(Number(value ?? 0))}件`,
                          "来店数",
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <LegendList data={visitTypeData} />
              </ChartCard>
            </section>
            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
  <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <div className="text-xs font-bold text-blue-600">
        AREA COMPARISON
      </div>

      <h2 className="mt-1 text-xl font-bold">
        {selectedRegionName
          ? `${selectedRegionName} 町名別 店舗比較`
          : "地域別 店舗比較"}
      </h2>

      <p className="mt-1 text-sm text-slate-500">
        {selectedMonth ? monthLabel(selectedMonth) : "対象月未選択"}
        {selectedRegionName
          ? `・${selectedRegionName}内の町名別来店数`
          : "・市区町村別来店数"}
      </p>
    </div>

    {selectedRegionName && (
      <button
        type="button"
        onClick={() => {
          setSelectedRegionName("");
          setSelectedTown(null);
        }}
        className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
      >
        ← 市区町村比較に戻る
      </button>
    )}
  </div>

  <div className="h-[520px]">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={
          selectedRegionName
            ? townComparisonData.slice(0, 15)
            : regionComparisonData.slice(0, 15)
        }
        layout="vertical"
        margin={{
          top: 10,
          right: 30,
          left: selectedRegionName ? 90 : 50,
          bottom: 10,
        }}
        onClick={(state) => {
          if (selectedRegionName) {
            return;
          }

          const name = String(state?.activeLabel ?? "");

          if (!name) {
            return;
          }

          setSelectedTown(null);
          setSelectedRegionName(name);
        }}
      >
        <CartesianGrid strokeDasharray="3 3" />

        <XAxis
          type="number"
          allowDecimals={false}
        />

        <YAxis
          type="category"
          dataKey="name"
          width={selectedRegionName ? 170 : 130}
          tick={{ fontSize: 12 }}
          tickFormatter={(value) =>
            selectedRegionName
              ? shortenLabel(String(value), 16)
              : shortenLabel(String(value), 12)
          }
        />

        <Tooltip
          formatter={(value, name) => {
            const label =
              name === "store1"
                ? STORE_NAMES[0]
                : name === "store2"
                ? STORE_NAMES[1]
                : name;

            return [
              `${formatNumber(Number(value ?? 0))}件`,
              label,
            ];
          }}
        />

        <Bar
          dataKey="store1"
          name="store1"
          fill="#2563eb"
          radius={[0, 6, 6, 0]}
          className={
            selectedRegionName
              ? ""
              : "cursor-pointer"
          }
        />

        <Bar
          dataKey="store2"
          name="store2"
          fill="#14b8a6"
          radius={[0, 6, 6, 0]}
          className={
            selectedRegionName
              ? ""
              : "cursor-pointer"
          }
        />
      </BarChart>
    </ResponsiveContainer>
  </div>

  {!selectedRegionName && (
    <div className="mt-2 text-xs text-slate-500">
      ※ 地域の棒をクリックすると町名別比較に切り替わります
    </div>
  )}

  <div className="mt-4 flex flex-wrap gap-4 text-sm">
    <div className="flex items-center gap-2">
      <span className="h-3 w-3 rounded-full bg-blue-600" />

      <span className="font-semibold text-slate-700">
        {STORE_NAMES[0]}
      </span>
    </div>

    <div className="flex items-center gap-2">
      <span className="h-3 w-3 rounded-full bg-teal-500" />

      <span className="font-semibold text-slate-700">
        {STORE_NAMES[1]}
      </span>
    </div>
  </div>
</section>
           <section className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
  <ChartCard
    title="地域別 来店数"
    subtitle="住所から市区町村を自動抽出"
  >
    <div className="h-[520px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={regionData.slice(0, 15)}
          layout="vertical"
          margin={{
            top: 10,
            right: 20,
            left: 30,
            bottom: 10,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" />

          <XAxis
            type="number"
            allowDecimals={false}
          />

          <YAxis
            type="category"
            dataKey="name"
            width={130}
            tick={{ fontSize: 12 }}
          />

          <Tooltip
            formatter={(value) => [
              `${formatNumber(Number(value ?? 0))}件`,
              "来店数",
            ]}
          />

          <Bar
            dataKey="visitors"
            fill="#2563eb"
            radius={[0, 6, 6, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </ChartCard>

  <ChartCard
    title="地域ランキング"
    subtitle="来店数・売上・買取・粗利"
  >
    <div className="space-y-3">
      {regionData.slice(0, 10).map((item, index) => (
        <div
  key={item.name}
  onClick={() => setSelectedCity(item.name)}
  className="rounded-xl bg-slate-50 px-4 py-4 cursor-pointer hover:bg-blue-50 transition"
>
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
                {index + 1}
              </div>

              <div className="truncate font-bold">
                {item.name}
              </div>
            </div>

            <div className="shrink-0 text-lg font-bold">
              {item.visitors}件
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <div>
              <div className="text-xs text-slate-500">
                売上
              </div>

              <div className="font-semibold">
                {formatYen(item.sales)}
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500">
                買取
              </div>

              <div className="font-semibold">
                {formatYen(item.purchase)}
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500">
                粗利
              </div>

              <div className="font-semibold">
                {formatYen(item.profit)}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </ChartCard>
</section> 
<section className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
  <ChartCard
    title={
  selectedRegionName
    ? `${selectedRegionName}  町名ランキング`
    : "町名ランキング TOP20"
} 
subtitle={
  selectedRegionName
    ? `${selectedRegionName}内の町名・大字`
    : "住所から町名・大字を自動抽出"
}
  >
    <div className="h-[620px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={filteredTownData.slice(0, 20)}
          layout="vertical"
          margin={{
            top: 10,
            right: 20,
            left: 70,
            bottom: 10,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" />

          <XAxis
            type="number"
            allowDecimals={false}
          />

          <YAxis
            type="category"
            dataKey="name"
            width={150}
            tick={{
              fontSize: 11,
            }}
            tickFormatter={(value) =>
              shortenLabel(value, 12)
            }
          />

          <Tooltip
            formatter={(value) => [
              `${formatNumber(
                Number(value ?? 0)
              )}件`,
              "来店数",
            ]}
          />

          <Bar
            dataKey="visitors"
            fill="#2563eb"
            radius={[0, 6, 6, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </ChartCard>

  <ChartCard
    title="町名ランキング TOP20"
    subtitle="来店数・売上・買取・粗利"
  >
      {selectedRegionName && (
    <button
      type="button"
      onClick={() => setSelectedRegionName("")}
      className="mb-4 rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"
    >
      ← 全地域に戻す
    </button>
  )}
    <div className="max-h-[620px] space-y-3 overflow-y-auto pr-2">
      {filteredTownData.slice(0, 20).map((item, index) => (
        <div
  key={item.name}
  onClick={() => setSelectedTown(item.name)}
  className={`rounded-xl px-4 py-4 cursor-pointer transition ${
    selectedTown === item.name
      ? "bg-blue-100 ring-2 ring-blue-500"
      : "bg-slate-50 hover:bg-blue-50"
  }`}
>
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
                {index + 1}
              </div>

              <div className="truncate font-bold">
                {item.name}
              </div>
            </div>

            <div className="shrink-0 text-lg font-bold">
              {item.visitors}件
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <div>
              <div className="text-xs text-slate-500">
                売上
              </div>

              <div className="font-semibold">
                {formatYen(item.sales)}
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500">
                買取
              </div>

              <div className="font-semibold">
                {formatYen(item.purchase)}
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500">
                粗利
              </div>

              <div className="font-semibold">
                {formatYen(item.profit)}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </ChartCard>
</section>

<section className="mt-6 rounded-2xl bg-white p-5 shadow-sm md:p-6">
 <NaraMap
  regionData={regionData}
  townData={townData}
  onSelectRegion={setSelectedRegionName}
  onSelectTown={setSelectedTown}
/>
</section>
          </>
        )}
      </div>
    </main>
  );
}

function KpiCard({
  title,
  value,
  comparison,
}: {
  title: string;
  value: string;
  comparison: string;
}) {
  const positive = comparison.startsWith("+");
  const negative = comparison.startsWith("-");

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <p className="text-sm font-bold text-slate-600">{title}</p>

      <div className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
        {value}
      </div>

      <div className="mt-4 flex items-center gap-2 text-sm">
  <span className="text-slate-400">前月比</span>

  <span
    className={`rounded-full px-2.5 py-1 text-xs font-bold ${
      positive
        ? "bg-emerald-50 text-emerald-700"
        : negative
        ? "bg-red-50 text-red-700"
        : "bg-slate-100 text-slate-600"
    }`}
  >
    {comparison}
  </span>
</div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>

      {children}
    </section>
  );
}

function LegendList({
  data,
  currency = false,
}: {
  data: {
    name: string;
    value: number;
  }[];
  currency?: boolean;
}) {
  return (
    <div className="mt-2 space-y-2">
      {data.map((item, index) => (
        <div
          key={item.name}
          className="flex items-center justify-between gap-3 text-sm"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{
                backgroundColor: COLORS[index % COLORS.length],
              }}
            />

            <span className="truncate">{item.name}</span>
          </div>

          <span className="shrink-0 font-semibold">
            {currency
              ? formatYen(item.value)
              : `${formatNumber(item.value)}件`}
          </span>
        </div>
      ))}
    </div>
  );
}