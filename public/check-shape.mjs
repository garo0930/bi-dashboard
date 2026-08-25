import * as shapefile from "shapefile";

const source = await shapefile.open(
  "./data/r2ka29.shp",
  "./data/r2ka29.dbf"
);

for (let i = 0; i < 5; i++) {
  const result = await source.read();

  if (result.done) break;

  console.log(`===== データ ${i + 1} =====`);
  console.log(result.value.properties);
}