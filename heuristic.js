/*
 * Copyright (c) 2015 Adobe Systems Incorporated. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var URL = require("url");

module.exports = function (entries, request) {
    var topPoints = 0;
    var topEntry = null;

    var entry;
    for (var i = 0; i < entries.length; i++) {
        entry = entries[i];
        if (!entry.request.parsedUrl) {
            entry.request.parsedUrl = URL.parse(entry.request.url, true);
        }
        if (!entry.request.indexedHeaders) {
            entry.request.indexedHeaders = indexHeaders(entry.request.headers);
        }
        var points = rate(entry.request, request);
        if (points > topPoints) {
            topPoints = points;
            topEntry = entry;
        }
    }

    return topEntry;
};

function isCookieIdentical(cookie1, cookie2) {
    var cookie1Keys = Object.keys(cookie1);
    var cookie2Keys = Object.keys(cookie2);

    if (cookie1Keys.length !== cookie2Keys.length) {
        return false;
    }

    return cookie1Keys.every(function (cookieField) {
        return cookie1[cookieField] === cookie2[cookieField];
    });
};

function indexCookies(cookieArray) {
    return cookieArray.reduce(function (collection, item) {
        collection[item.name] = item;
        return collection;
    }, Object.create(null));
};

function areAllCookiesIdentical(cookieArray1, cookieArray2) {
    if (cookieArray1.length !== cookieArray2.length) {
        return false;
    }

    var cookieArray1Indexed = indexCookies(cookieArray1);
    var cookieArray2Indexed = indexCookies(cookieArray2);

    return Object.keys(cookieArray1Indexed).every(function (cookieName)  {

        var cookie2 = cookieArray2Indexed[cookieName];

        if (cookie2 === undefined) {
            return false;
        }

        return isCookieIdentical(
            cookieArray1Indexed[cookieName],
            cookie2
        );
    });
};

function rate(entryRequest, request) {
    var points = 0;
    var name;

    // method, host and pathname must match
    if (
        entryRequest.method !== request.method ||
        (request.parsedUrl.host !== null && entryRequest.parsedUrl.host !== request.parsedUrl.host) ||
        entryRequest.parsedUrl.pathname !== request.parsedUrl.pathname
    ) {
        return 0;
    }

    // One point for matching above requirements
    points += 1;

    // each query
    var entryQuery = entryRequest.parsedUrl.query;
    var requestQuery = request.parsedUrl.query;
    if (entryQuery && requestQuery) {
        for (name in requestQuery) {
            if (entryQuery[name] === undefined) {
                points -= 0.5;
            } else {
                points += stripProtocol(entryQuery[name]) === stripProtocol(requestQuery[name]) ? 1 : 0;
            }
        }

        for (name in entryQuery) {
            if (requestQuery[name] === undefined) {
                points -= 0.5;
            }
        }
    }

    // Prefer responses where cookies match between the new request, and the
    // considered request in the HAR.  "Award" 2 points if all cookies match,
    // and otherwise 0.
    var entryCookies = entryRequest.cookies;
    var requestCookies = request.cookies;
    if (areAllCookiesIdentical(entryCookies, requestCookies) {
        points += 2;
    }

    // each header
    var entryHeaders = entryRequest.indexedHeaders;
    var requestHeaders = request.headers;
    for (name in requestHeaders) {
        // Don't double count cookies, since they're dealt with above.
        if (name === "cookie") {
            continue;
        }
        if (entryHeaders[name]) {
            points += stripProtocol(entryHeaders[name]) === stripProtocol(requestHeaders[name]) ? 1 : 0;
        }
        // TODO handle missing headers and adjust score appropriately
    }

    return points;
}

function stripProtocol(string) {
    if (typeof string === "string") {
        return string.replace(/^https?/, "");
    } else {
        return string;
    }
}

function indexHeaders(entryHeaders) {
    var headers = {};
    entryHeaders.forEach(function (header) {
        headers[header.name.toLowerCase()] = header.value;
        // TODO handle multiple of the same named header
    });
    return headers;
}
