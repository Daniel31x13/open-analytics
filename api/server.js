const assignUser = require("./lib/assignUser");
const geoip = require("fast-geoip");
const express = require("express");
const { MongoClient } = require("mongodb");
const app = express();
const config = require("../src/config.json");
const fs = require('fs');

tls_key = () => {
  try {
    return fs.readFileSync(config.tls_support.key);
  } catch (err) {
    return "";
    console.log(err);
  }
}

tls_cert = () => {
  try {
    return fs.readFileSync(config.tls_support.cert);
  } catch (err) {
    return "";
    console.log(err);
  }
}

const option = {
  key: tls_key,
  cert: tls_cert,
  cors: {
      origin: '*',
    }
}

const http = require(config.tls_support.enabled ? "https" : "http").createServer(option, app);
const io = require("socket.io")(http, {
  cors: {
    origin: "*",
  },
});

const cors = require("cors");

const PORT = config.api.port;
let count = 0;
let totalClients = [];

// Connect to MongoDB
const uri = config.api.uri;
const MClient = new MongoClient(uri);
MClient.connect().catch(console.error);

let results;
app.use(async (req, res, next) => {
  let lastMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth() - 1,
    new Date().getDate()
  );
  results = await MClient.db(config.api.databaseName)
    .collection(config.api.collectionName)
    .find({Date: {$gt: lastMonth}})
    .toArray();
  next();
});

app.get("/api", cors(), (req, res) => {
  res.send(results);
});

app.get("/api/active", cors(), (req, res) => {
  res.send(count.toString());
});

// On connection
io.on("connection", async (socket) => {
  let clientIp = socket.request.connection.remoteAddress;
  let clientHeader = socket.request.headers["user-agent"];
  let geo = await geoip.lookup(clientIp.slice(7)); // Check location by ip (Does not work for local ip addresses)
  let clientURL;
  let clientReferrer;
  let isNewUser;

  // Add user to array
  totalClients.push(clientIp);

  // The number of unique clients from the array
  count = totalClients.filter(function (item, pos) {
    return totalClients.indexOf(item) == pos;
  }).length;

  const connectDate = new Date();

  console.clear(); // Clear previous log

  io.emit("socketClientID", socket.client.id);
  socket.on("clientMessage", (data) => { // Get data from client
    clientURL = data.url;
    clientReferrer = data.referrer;
    isNewUser = data.isFirstVisit;
    isNewUser = data.isFirstVisit;
  });

  // On disconnection
  socket.on("disconnect", () => {
    const disconnectDate = new Date();
    let activeTime = Math.ceil(
      (disconnectDate - connectDate) / 1000
    ).toString();

    // Remove user from array & update the number of unique clients from the array
    totalClients.splice(totalClients.indexOf(clientIp), 1);
    count = totalClients.filter(function (item, pos) {
      return totalClients.indexOf(item) == pos;
    }).length;

    let user = assignUser(
      clientIp,
      geo.country,
      clientHeader,
      clientURL,
      clientReferrer,
      connectDate,
      activeTime,
      isNewUser
    );

    // Add to DB
    MClient.db(config.api.databaseName).collection(config.api.collectionName).insertOne(user);
  });
});

http.listen(PORT, () => {
  console.clear();
  console.log("ALL SET!");
});
