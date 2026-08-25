import * as shapefile from "shapefile";
import fs from "node:fs/promises";

const source = await shapefile.open(
  "./data/r2ka29.shp",
  "./data/r2ka29.dbf",
  {
    encoding: "shift_jis",
  }
);

const features = [];

while (true) {
  const result = await source.read();

  if (result.done) break;

  const feature = result.value;

  // 桜井市だけ抽出
  if (String(feature.properties.CITY) !== "206") {
    continue;
  }

  const townName = feature.properties.S_NAME ?? "名称不明";

  feature.properties = {
    ...feature.properties,

    // NaraMap.tsx で扱いやすい項目を追加
    displayName: townName,
    municipality: "桜井市",
    town: townName,
  };

  features.push(feature);
}

const geojson = {
  type: "FeatureCollection",
  features,
};

await fs.writeFile(
  "./public/maps/sakurai-towns-map.geojson",
  JSON.stringify(geojson, null, 2),
  "utf8"
);

console.log("--------------------------------");
console.log("桜井市の町名GeoJSONを作成しました");
console.log(`町名ポリゴン数: ${features.length}`);
console.log("--------------------------------");

console.log(
  features.slice(0, 10).map((feature) => ({
    city: feature.properties.CITY_NAME,
    town: feature.properties.S_NAME,
  }))
);