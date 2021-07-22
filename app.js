var express = require('express')
var puppeteer = require('puppeteer')
var bodyParser = require('body-parser');
var _ = require("underscore");
var fs = require("fs");
const fetch = require("node-fetch");

var app = express()

class PuppeteerNetworkMonitor {

    constructor(page) {
        this.promisees = [];
        this.page = page;
        this.resourceType = ['image'];
        this.pendingRequests = new Set();
        this.finishedRequestsWithSuccess = new Set();
        this.finishedRequestsWithErrors = new Set();
        page.on('request', (request) => {
            request.continue();
            if (this.resourceType.includes(request.resourceType())) {
                this.pendingRequests.add(request);
                this.promisees.push(
                    new Promise(resolve => {
                        request.resolver = resolve;
                    }),
                );
            }
        });
        page.on('requestfailed', (request) => {
            if (this.resourceType.includes(request.resourceType())) {
                this.pendingRequests.delete(request);
                this.finishedRequestsWithErrors.add(request);
                if (request.resolver) {
                    request.resolver();
                    delete request.resolver;
                }
            }
        });
        page.on('requestfinished', (request) => {
            if (this.resourceType.includes(request.resourceType())) {
                this.pendingRequests.delete(request);
                this.finishedRequestsWithSuccess.add(request);
                if (request.resolver) {
                    request.resolver();
                    delete request.resolver;
                }
            }
        });
    }

    async waitForAllRequests() {
        if (this.pendingRequestCount() === 0) {
            return;
        }
        await Promise.all(this.promisees);
    }

    pendingRequestCount() {
        return this.pendingRequests.size;
    }
}




app.set('port', 3000);
// parse application/json
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());

app.post('/', function (request, response) {
    console.log('POST /')
    var stringHtml = "<div class='messages-container'>";
    let messages = [];
    getMessages(request.body).forEach(m => {
        var message = new Message(m['id'], m['created'], m['from'], m['media'], m['mediaType'], m['content']);
        stringHtml = stringHtml + "<div class='wrapper'><div class='message " + message.from + "'>";
        messages.push(message);
        if (message.from != "CONTACT" && message.from != "AGENT") {
            stringHtml = stringHtml + "<strong class='automatic'>Mensaje automático</strong><br>";
        }
        if (message.media != null) {
            switch (message.mediaType) {
                case 'IMAGE':
                    stringHtml = stringHtml + "<img class='image' src='" + message.media + "'><br><small class='url'><a href ='" + message.media + "'>Ver imagen</a></small>"
                    break;
                case 'DOCUMENT':
                    stringHtml = stringHtml + "Documento url: <small class='url'><a href ='" + message.media + "'>Ver documento</a></small>";
                    break;
                case 'AUDIO':
                    stringHtml = stringHtml + "Audio url: <small class='url'><a href ='" + message.media + "'>Ver audio</a></small>";
                    break;
                case 'VIDEO':
                    stringHtml = stringHtml + "Video url: <small class='url'><a href ='" + message.media + "'>Ver video</a></small>";
                    break;
                default:
                    stringHtml = stringHtml + "" + message.content;
            }
        }
        if (message.content && message.media == null) {
            stringHtml = stringHtml + "" + message.content;
        }
        stringHtml = stringHtml + "<span class='date'>" + new Date(message.created).toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true }) + "</span></div></div>";
    });
    stringHtml = stringHtml + "</div><style> .automatic { font-style: italic; font-size: small; } .message { position: relative; box-shadow: 0 1px 0.5px rgb(0 0 0 / 13%); border: 1px solid rgba(0, 0, 0, .1); max-width: 400px; display: flex; justify-content: space-between; align-items: stretch; flex-direction: column; transition: .5s; padding: 6px 7px 20px 9px; min-width: 60px; } .messages-container { max-width: 90%; display: block; } .CONTACT { border-radius: 15px 15px 15px 0; cursor: pointer; background: #fff; align-self: flex-start; } .BOT, .DIFFUSER, .EXTERNAL { border-radius: 15px 15px 0; background: #c9d0d4; align-self: flex-end; } span.date { position: absolute; right: 7px; bottom: 3px; font-size: .7em; user-select: none; text-align: right; } .wrapper { display: flex; flex-direction: column; margin: 8px 15px 0; width: calc(100% - 25px); font-size: 1.1em; } .AGENT { border-radius: 15px 15px 0; cursor: pointer; background: #d9ffc5; align-self: flex-end; } .url { width: 300px; word-wrap: break-word; }.image {width: 300px;}html {-webkit-print-color-adjust: exact;}</style>";

    console.log(stringHtml);

    //getFromUrl(stringHtml, messages).then(stringData => {
        printPDF(stringHtml).then(pdf => {
            let data = {
                data: Uint8Array.from(pdf).toString()
            };

            fs.open('pruebaaaa.pdf', 'w', function (err, fd) {
                if (err) {
                    throw 'could not open file: ' + err;
                }
                fs.write(fd, pdf, 0, pdf.length, null, function (err) {
                    if (err) throw 'error writing file: ' + err;
                    fs.close(fd, function () {
                        console.log('wrote the file successfully');
                    });
                });
            })
            //console.log(Uint8Array.from(pdf).toString());


            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify(data));
        });

    //});

});

function getMessages(body) {
    var messages = [];
    var jsonObject = JSON.parse(JSON.stringify(body));
    _.map(jsonObject, function (content) {
        _.map(content, function (data) {
            messages.push({
                id: data.id,
                created: data.created,
                from: data.from,
                media: data.media ? data.media : null,
                mediaType: data.mediaType ? data.mediaType : null,
                content: data.content ? data.content : null
            });
        });
    });
    return messages;
}

async function printPDF(stringData) {
    console.log('stringData', stringData);
    console.log('=== printPDF Launch Start ' + new Date());
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(0);
    await page.emulateMediaType('screen');
    await page.setContent(stringData, {
        waitUntil: "networkidle0"
    });
    await page.setRequestInterception(true);
    let monitorRequests = new PuppeteerNetworkMonitor(page);
    await monitorRequests.waitForAllRequests();

    const pdf = await page.pdf({
        format: 'A4',
        margin: { left: '1cm', top: '1cm', right: '1cm', bottom: '1cm' },
        printBackground: true
    });
    await browser.close();


    return pdf
};

async function getFromUrl(stringHtml, messages) {
    var dummyImage = "https://assets.hibot.us/images/hbt-content-based/4491976e8d0ca8a35eabb3c5506fe810ac64bba1e8309bb300354fbfb87adc4d@jpg";
    console.log(messages);
    for (const [index, m] of messages.entries()) {
        console.log(m);
        var myHeaders = new fetch.Headers();
        myHeaders.append('Access-Control-Allow-Origin', '*');

        var myInit = {
            method: 'GET',
            headers: myHeaders,
            mode: 'cors',
            cache: 'default'
        };

        const request = new fetch.Request(m.mediaType === 'IMAGE' ? m.media : dummyImage, myInit);

        const data = await fetch(request);
        const blob = await data.blob();
        console.log('blob', blob);
        stringHtml = stringHtml.replace(m.id, blob);
        if (index === messages.length - 1) {
            console.log('entraa', stringHtml);
            return stringHtml;
        }
    }
}


function Message(id, created, from, media, mediaType, content) {
    var message = {};
    message.id = id;
    message.created = created;
    message.from = from;
    message.media = media;
    message.mediaType = mediaType;
    message.content = content;

    return message;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(() => resolve(), ms));
}

app.listen(app.get('port'), function () {
    console.log('Express server on port ' + app.get('port'));
});