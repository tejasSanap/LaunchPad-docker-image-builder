const { exec } = require("child_process");
const path = require("path");

const fs = require("fs");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const mime = require("mime-types");
const { promisify } = require("util");

const { Kafka } = require("kafkajs");

const s3Client = new S3Client({
  region: "",
  credentials: {
    accessKeyId: "",
    secretAccessKey: "",
  },
});

const PROJECT_ID = process.env.PROJECT_ID;
const DEPLOYEMENT_ID = process.env.DEPLOYEMENT_ID;

const kafka = new Kafka({
  clientId: `docker-container-${{ DEPLOYEMENT_ID }}`,
  brokers: [""],

  ssl: { ca: [fs.readFileSync(path.join(__dirname, "kafka.pem"), "utf-8")] },
  sasl: {
    username: "",
    password: "",
    mechanism: "",
  },
});

const producer = kafka.producer();

async function publishLog(log) {
  // publisher.publish(`logs:${PROJECT_ID}`, JSON.stringify({log}))
  console.log("DEPLOYEMENT_ID", DEPLOYEMENT_ID);
  await producer.send({
    topic: `container-logs`,
    messages: [
      {
        key: "log",
        value: JSON.stringify({
          PROJECT_ID,
          DEPLOYEMENT_ID,
          log,
        }),
      },
    ],
  });
}

const execPromise = promisify(exec);

async function init() {
  await producer.connect();

  console.log("Executing npw ");
  await publishLog("Build Started...");
  const outDirPath = path.join(__dirname, "output");

  const { stdout, stderr } = await execPromise(
    `cd ${outDirPath} && npm install && npm run build`
  );

  if (stdout) {
    console.log("Build output:\n", stdout);
    await publishLog(stdout.toString());
  }

  if (stderr) {
    console.error("Build error:\n", stderr);
    await publishLog(`Error : ${stderr.toString()}`);
  }
  // const p =  exec(`cd ${outDirPath} && npm install && npm run build`)
  // p.stdout.on('data', function (data) {
  //   console.log(data.toString())
  // })

  // p.stdout.on('error', function (data) {
  //   console.log('Error', data.toString())
  // })

  try {
    await publishLog("Build complete");

    const distFolderPath = path.join(__dirname, "output", "dist");
    const distFolderContents = fs.readdirSync(distFolderPath, {
      recursive: true,
    });
    console.log("distFolderPath", distFolderPath);
    console.log("distFolderContents", distFolderContents);

    await publishLog("Starting to upload");

    for (const file of distFolderContents) {
      const filePath = path.join(distFolderPath, file);
      if (fs.lstatSync(filePath).isDirectory()) continue;

      console.log("uploading file path", `__outputs/${DEPLOYEMENT_ID}/${file}`);

      await publishLog(`uploading ${file}`);
      const command = new PutObjectCommand({
        Bucket: "launchpad-bucket-build",
        Key: `__outputs/${DEPLOYEMENT_ID}/${file}`,
        Body: fs.createReadStream(filePath),
        ContentType: mime.lookup(filePath),
      });

      await s3Client.send(command);
      await publishLog(`Uploaded ${file}`);
    }
    console.log("done");
    await publishLog(`Done`);
  } catch (error) {
    console.error("error", error);
  }
  process.exit(0);
}
init();
