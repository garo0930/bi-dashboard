"use client";

import { useEffect, useMemo, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import type {
  Feature,
  FeatureCollection,
  Geometry,
  GeoJsonProperties,
} from "geojson";

export type MapMetric = "visitors" | "sales" | "purchase" | "profit";

export type RegionData = {
  name: string;
  visitors: number;
  sales: number;
  purchase: number;
  profit: number;
};

export type TownData = {
  name: string;
  visitors: number;
  sales: number;
  purchase: number;
  profit: number;
};

type Props = {
  regionData: RegionData[];
  townData: TownData[];
  onSelectRegion?: (regionName: string) => void;
  onSelectTown?: (townName: string) => void;
};

type SelectedRegion = RegionData & {
  mapName: string;
};

const WIDTH = 700;
const HEIGHT = 620;

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

function getFeatureName(
  feature: Feature<Geometry, GeoJsonProperties>
): string {
  const properties = feature.properties;

  if (!properties) return "名称不明";

  const displayName = properties.displayName;
  const municipality = properties.municipality;
  const ward = properties.ward;
  const county = properties.county;

  if (typeof displayName === "string" && displayName.trim()) {
    return displayName.trim();
  }

  if (typeof county === "string" && typeof municipality === "string") {
    return `${county}${municipality}`.trim();
  }

  if (typeof municipality === "string" && typeof ward === "string") {
    return `${municipality}${ward}`.trim();
  }

  if (typeof municipality === "string") {
    return municipality.trim();
  }

  return "名称不明";
}

function normalizeName(value: string) {
  return value
    .replace(/^奈良県/, "")
    .replace(/\s/g, "")
    .trim();
}

function normalizeTownName(value: string) {
  return normalizeName(value)
    .replace(/^桜井市/, "")
    .replace(/^大字/, "")
    .trim();
}

export default function NaraMap({
  regionData,
  townData,
  onSelectRegion,
  onSelectTown,
}: Props) {
  const [geoData, setGeoData] =
    useState<FeatureCollection<Geometry, GeoJsonProperties> | null>(null);

  const [metric, setMetric] = useState<MapMetric>("visitors");

  const [selectedRegion, setSelectedRegion] =
    useState<SelectedRegion | null>(null);

const [mapMode, setMapMode] = useState<"nara" | "sakurai">("nara");

  const [hoveredName, setHoveredName] = useState<string>("");

  const [error, setError] = useState("");

  useEffect(() => {
    const loadMap = async () => {
      try {
        const mapUrl =
  mapMode === "sakurai"
    ? "/maps/sakurai-towns-map.geojson"
    : "/maps/nara.geojson";

const response = await fetch(mapUrl);

        if (!response.ok) {
          throw new Error("GeoJSONを読み込めませんでした。");
        }

        const data =
          (await response.json()) as FeatureCollection<
            Geometry,
            GeoJsonProperties
          >;

        setGeoData(data);
      } catch (err) {
        console.error(err);
        setError(
          "奈良県の地図データを読み込めませんでした。nara.geojson の配置を確認してください。"
        );
      }
    };

    loadMap();
 }, [mapMode]);

  const regionMap = useMemo(() => {
    const map = new Map<string, RegionData>();

    regionData.forEach((item) => {
      map.set(normalizeName(item.name), item);
    });

    return map;
  }, [regionData]);
 
 const townMap = useMemo(() => {
  const map = new Map<string, TownData>();

  townData.forEach((item) => {
    const normalized = normalizeTownName(item.name);

    map.set(normalized, item);
  });

  return map;
}, [townData]);

  const metricInfo = {
    visitors: {
      label: "来店数",
      format: (value: number) => `${formatNumber(value)}件`,
    },

    sales: {
      label: "売上",
      format: (value: number) => formatYen(value),
    },

    purchase: {
      label: "買取金額",
      format: (value: number) => formatYen(value),
    },

    profit: {
      label: "粗利",
      format: (value: number) => formatYen(value),
    },
  };

  const maxValue = useMemo(() => {
  // 桜井市の町名地図では町名データの最大来店数を使用
  if (mapMode === "sakurai") {
  if (townData.length === 0) return 0;

  return Math.max(
    ...townData.map((item) => item[metric]),
    0
  );
}

  // 奈良県地図では従来どおり市区町村データを使用
  if (regionData.length === 0) return 0;

  return Math.max(...regionData.map((item) => item[metric]), 0);
}, [mapMode, townData, regionData, metric]);

  const projection = useMemo(() => {
    if (!geoData) return null;

    return geoMercator().fitExtent(
      [
        [20, 20],
        [WIDTH - 20, HEIGHT - 20],
      ],
      geoData
    );
  }, [geoData]);

  const pathGenerator = useMemo(() => {
    if (!projection) return null;

    return geoPath(projection);
  }, [projection]);

  function getColor(value: number) {
    if (value <= 0 || maxValue <= 0) {
      return "#e2e8f0";
    }

    const ratio = Math.min(value / maxValue, 1);

    if (ratio >= 0.8) return "#1d4ed8";
    if (ratio >= 0.6) return "#2563eb";
    if (ratio >= 0.4) return "#3b82f6";
    if (ratio >= 0.2) return "#60a5fa";
    if (ratio > 0) return "#bfdbfe";

    return "#e2e8f0";
  }

  function getRegionForFeature(
    feature: Feature<Geometry, GeoJsonProperties>
  ) {
    const featureName = normalizeName(getFeatureName(feature));

    if (regionMap.has(featureName)) {
      return regionMap.get(featureName);
    }

    for (const [regionName, data] of regionMap.entries()) {
      if (
        featureName.includes(regionName) ||
        regionName.includes(featureName)
      ) {
        return data;
      }
    }

    return undefined;
  }
  
 function getTownForFeature(
  feature: Feature<Geometry, GeoJsonProperties>
) {
  const properties = feature.properties;

  if (!properties) return undefined;

  const townName =
    typeof properties.S_NAME === "string"
      ? properties.S_NAME.trim()
      : typeof properties.displayName === "string"
      ? properties.displayName.trim()
      : "";

  if (!townName) return undefined;

  const normalizedTownName = normalizeTownName(townName);
 let found = townMap.get(normalizedTownName);

// 完全一致しない場合、町名の親名称で照合
if (!found) {
  for (const [key, data] of townMap.entries()) {
    if (
      normalizedTownName.startsWith(key) ||
      key.startsWith(normalizedTownName)
    ) {
      found = data;
      break;
    }
  }
}

if (mapMode === "sakurai") {
  console.log("地図町名:", townName);
  console.log("変換後:", normalizedTownName);
  console.log("一致データ:", found);
}

return found;
}

  if (error) {
    return (
      <div className="rounded-xl bg-red-50 p-5 text-sm font-semibold text-red-700">
        {error}
      </div>
    );
  }

  if (!geoData || !pathGenerator) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-slate-500">
        地図を読み込んでいます...
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
  <h2 className="text-xl font-bold">
    {mapMode === "sakurai"
      ? "桜井市 町名マップ"
      : "奈良県 商圏マップ"}
  </h2>

  <p className="mt-1 text-sm text-slate-500">
    {mapMode === "sakurai"
      ? "桜井市の町名・大字ごとの実績を確認できます"
      : "市区町村ごとの実績を地図上で確認できます"}
  </p>

  {mapMode === "sakurai" && (
    <button
      type="button"
      onClick={() => {
        setMapMode("nara");
        setSelectedRegion(null);
        setHoveredName("");
      }}
      className="mt-3 rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
    >
      ← 奈良県全体に戻る
    </button>
  )}
</div>

        <div className="flex flex-wrap gap-2">
          {(Object.keys(metricInfo) as MapMetric[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setMetric(key)}
              className={`min-h-10 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                metric === key
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {metricInfo[key].label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.7fr)]">
        <div className="rounded-xl bg-slate-50 p-3">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-auto w-full"
            role="img"
            aria-label="奈良県市区町村別実績地図"
          >
            {geoData.features.map((feature, index) => {
              const region = getRegionForFeature(feature);
              const town = getTownForFeature(feature);
              const mapName = getFeatureName(feature);

              const value =
                mapMode === "sakurai"
                ? town?.[metric] ?? 0
                 : region
                ? region[metric]
                       : 0;

              const path = pathGenerator(feature);

              if (!path) return null;

              const isSelected =
                selectedRegion?.mapName === mapName;

              return (
                <path
                  key={`${mapName}-${index}`}
                  d={path}
                  fill={getColor(value)}
                  stroke={
                    isSelected ? "#0f172a" : "#ffffff"
                  }
                  strokeWidth={isSelected ? 3 : 1.2}
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onMouseEnter={() => {
                    setHoveredName(mapName);
                  }}
                  onMouseLeave={() => {
                    setHoveredName("");
                  }}
                 onClick={() => {
  // 奈良県地図で桜井市をクリックしたら町名地図へ切り替える
  if (
    mapMode === "nara" &&
    normalizeName(mapName) === "桜井市"
  ) {
    setMapMode("sakurai");
  }
 if (mapMode === "sakurai" && town) {
  setSelectedRegion({
    name: town.name,
    mapName,
    visitors: town.visitors,
    sales: town.sales,
    purchase: town.purchase,
    profit: town.profit,
  });

  onSelectTown?.(town.name);
  return;
}
  
  if (region) {
    setSelectedRegion({
      ...region,
      mapName,
    });

    onSelectRegion?.(region.name);
  } else {
    setSelectedRegion({
      name: mapName,
      mapName,
      visitors: 0,
      sales: 0,
      purchase: 0,
      profit: 0,
    });

    onSelectRegion?.(normalizeName(mapName));
  }
}}
                />
              );
            })}
          </svg>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
            <span>
              薄い
              <span className="mx-2 inline-block h-3 w-24 rounded bg-gradient-to-r from-blue-100 to-blue-700 align-middle" />
              濃い
            </span>

            <span>
              {metricInfo[metric].label}が多い地域ほど濃く表示
            </span>
          </div>

          {hoveredName && (
            <div className="mt-3 rounded-lg bg-white px-4 py-3 text-sm shadow-sm">
              <span className="font-bold">
                {hoveredName}
              </span>

              {(() => {
                const found = regionMap.get(
                  normalizeName(hoveredName)
                );

                if (!found) {
                  return (
                    <span className="ml-3 text-slate-500">
                      データなし
                    </span>
                  );
                }

                return (
                  <span className="ml-3 font-semibold text-blue-700">
                    {metricInfo[metric].format(found[metric])}
                  </span>
                );
              })()}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 text-sm font-semibold text-slate-500">
            選択地域
          </div>

          {selectedRegion ? (
            <>
              <div className="mb-6 text-2xl font-bold">
                {selectedRegion.name}
              </div>

              <div className="space-y-3">
                <MapValue
                  label="来店数"
                  value={`${formatNumber(
                    selectedRegion.visitors
                  )}件`}
                />

                <MapValue
                  label="売上"
                  value={formatYen(selectedRegion.sales)}
                />

                <MapValue
                  label="買取金額"
                  value={formatYen(
                    selectedRegion.purchase
                  )}
                />

                <MapValue
                  label="粗利"
                  value={formatYen(selectedRegion.profit)}
                />
              </div>
            </>
          ) : (
            <div className="rounded-xl bg-slate-50 p-5 text-sm leading-7 text-slate-500">
              地図上の市区町村をクリックすると、
              来店数・売上・買取金額・粗利を表示します。
            </div>
          )}

          <div className="mt-6 border-t border-slate-200 pt-5">
            <div className="mb-3 text-sm font-bold">
              地域 TOP5
            </div>

            <div className="space-y-3">
              {[...regionData]
                .sort(
                  (a, b) =>
                    Number(b[metric]) -
                    Number(a[metric])
                )
                .slice(0, 5)
                .map((item, index) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">
                        {index + 1}
                      </span>

                      <span className="truncate text-sm font-semibold">
                        {item.name}
                      </span>
                    </div>

                    <span className="shrink-0 text-sm font-bold">
                      {metricInfo[metric].format(
                        item[metric]
                      )}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MapValue({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-4">
      <span className="text-sm font-semibold text-slate-500">
        {label}
      </span>

      <span className="text-lg font-bold">{value}</span>
    </div>
  );
}