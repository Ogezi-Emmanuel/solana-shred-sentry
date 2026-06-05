import fs from 'fs';

const files = [
  "geyser.proto",
  "solana-storage.proto"
];

if (!fs.existsSync('./proto')) fs.mkdirSync('./proto');

for (const file of files) {
  console.log(`⬇️ Downloading ${file}...`);
  const res = await fetch(`https://raw.githubusercontent.com/rpcpool/yellowstone-grpc/master/yellowstone-grpc-proto/proto/${file}`);
  fs.writeFileSync(`./proto/${file}`, await res.text());
}
console.log("✅ Protos downloaded successfully!");