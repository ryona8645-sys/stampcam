import { zipSync, strToU8 } from "https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/index.mjs";

export async function exportProjectZipTest() {
  const files = {
    "hello.txt": strToU8("hello"),
    "devices.csv": strToU8("deviceNo,type\n001,router\n")
  };

  const zipped = zipSync(files, { level: 6 });
  const blob = new Blob([zipped], { type: "application/zip" });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "test.zip";
  a.click();

  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
