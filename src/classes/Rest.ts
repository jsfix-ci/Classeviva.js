import fetch, { BodyInit, HeadersInit, RequestInit, Response } from 'node-fetch';
import { parse, join } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { ClassOptions, User, Headers, FetchType, FetchMethod, FetchResponse, LoginResponse, AgendaFilter, TalkOptions, Overview, Card, ContentElement, FetchId, TermsAgreementResponse, setTermsAgreementResponse, readOptions, TokenStatus, TicketResponse, checkDocument, absences, readNotice, Grade, calendarDay } from '../typings/Rest';
import * as Enums from '../Enums';

class Rest {
    public readonly username: string;
    readonly #password: string;
    #token: string;

    readonly #state: string;
    readonly #baseUrl: string;
    readonly #directory: string;

    public login_timeout: NodeJS.Timeout;
    public expiration: string;
    
    public authorized: boolean;
    public user: User;

    readonly #app : string;
    #headers: Headers;
    constructor({ username, password, state = Enums.States.Italy, app = Enums.Apps.Students }: ClassOptions = {}) {
        this.username = username || "";
        this.#password = password || "";
        this.#token = "";

        this.#state = state;
        this.#baseUrl = `https://${Enums.Urls[this.#state]}/rest/v1`;
        this.#directory = join(parse(__dirname).dir, '..');

        this.login_timeout;
        this.expiration = "";

        this.authorized = false;
        this.user = {
            name: undefined,
            surname: undefined,
            id: undefined,
            ident: undefined,
            type: undefined,
            school: {}
        };

        this.#app = app;
        this.#headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": `${this.#app} iOS/15.4`,
            "Z-Dev-Apikey": "Tg1NWEwNGIgIC0K",
            "Z-If-None-Match": "",
        };
    }

    /**
     * Logins to Classeviva
     * @param {string} [username] Classeviva credentials username
     * @param {string} [password] Classeviva credentials password
     * @returns {object} user object
     */
    async login(username = this.username, password = this.#password): Promise<void | User> {
        if (this.authorized) return this.#log("Already logged in ❌");

        if (!username || !password) return this.#log("Username or password not set ❌");

        if (!await this.#checkTemp()) {
            const userData = {
                uid: username,
                pass: password,
            };
    
            const response: Response = await fetch(`${this.#baseUrl}/auth/login/`, {
                method: "POST",
                headers: this.#headers,
                body: JSON.stringify(userData),
            });
    
            const json: any = await response.json();
    
            if (json.error) {
                this.#log(`An error happened: ${json.message} (${json.statusCode}) ❌`);
                this.authorized = false;
                return;
            }

            if (response.status !== 200) return this.#log(`The server returned a status code other than 200 (${response.status}) ❌`);
            
            this.#updateData(json);
            await writeFileSync(`${this.#directory}/cvv.json`, JSON.stringify(json, null, 2));
        }

        if (!this.authorized) return this.#log("Failed to login ❌");

        this.#log(`Successfully logged in as "${this.user.name} ${this.user.surname}" ✅`);
        this.login_timeout = setTimeout(() => {
            this.login();
        }, 1000 * 60 * 60 * 1.5);
        return this.user;
    }

    /**
     * Logs out from Classeviva
     * @returns {boolean} true if logged out, false if already logged out
     */
    logout(): boolean {
        if (!this.authorized) {
            this.#log("Already logged out ❌");
            return false;
        }
        clearTimeout(this.login_timeout);
        this.authorized = false;
        this.#token = "";
        this.user = {};
        this.expiration = "";
        this.#log("Successfully logged out ✅");
        return true;
    }

    /**
     * Get student's cards
     * @returns {object[]} Array of objects containing the student's cards
     */
    async getCards(): Promise<Card[] | []> {
        const data: { cards?: Card[] } | void = await this.#fetch("/cards");
        if (data?.cards && data?.cards?.length > 0) this.#updateUser(data.cards[0]);
        
        return data?.cards ?? [];
    }

    /**
     * Get student's card
     * @returns {object} Object containing the student's card
     */
    async getCard(): Promise<Card | {}> {
        const data: { card?: Card } | void = await this.#fetch("/card");
        if (data?.card && Object.keys(data?.card).length > 0) this.#updateUser(data.card);

        return data?.card ?? {};
    }

    /**
     * Get student's grades
     * @returns {object[]} Array of objects containing the student's grades
     */
    async getGrades(): Promise<Grade[] | []> {
        const data: {grades: Grade[]} | void = await this.#fetch(`/grades2`);
        return data?.grades ?? [];
    }

    /**
     * Get student's absences
     * @returns {object[]} Array of objects containing the student's absences
     */
    async getAbsences(): Promise<absences[] | []> {
        const data: {events: absences[]} | void = await this.#fetch(`/absences/details`);
        return data?.events ?? [];
    }

    /**
     * Get student's agenda
     * @param {string} filter "all" | "homework" | "other", default "all", used to filter the agenda
     * @param {Date} start The start date of the agenda (defaults to today)
     * @param {Date} end  The end date of the agenda (defaults to today)
     * @returns {object[]} Array of objects containing the student's agenda
     */
    async getAgenda(filter: AgendaFilter = "all", start: Date = new Date(), end: Date = new Date()): Promise<any> {
        const filters = ["all", "homework", "other"];
        if (!filters.includes(filter)) return this.#log("Invalid filter ❌");
        const map = {
            all: "all",
            homework: "AGHW",
            other: "AGNT",
        };

        const data: any = await this.#fetch(`/agenda/${map[filter]}/${this.#formatDate(start)}/${this.#formatDate(end)}`);
        return data?.agenda ?? [];
    }

    /**
     * Get student's documents
     * @returns {object[]} Array of objects containing the student's documents
     */
    async getDocuments(): Promise<any> {
        const data: any = await this.#fetch("/documents", "POST");
        return data ?? [];
    }

    /**
     * Get student's noticeboard items
     * @returns {object[]} Array of objects containing the student's noticeboard items
     */
    async getNoticeboard(): Promise<any> {
        const data: any = await this.#fetch("/noticeboard");
        return data?.items ?? [];
    }

    /**
     * Get student's books
     * @returns {object[]} Array of objects containing the student's books
     */
    async getSchoolBooks(): Promise<any> {
        const data: any = await this.#fetch("/schoolbooks");
        return data?.schoolbooks ?? [];
    }

    /**
     * Get student's calendar
     * @returns {object[]} Array of objects containing the student's calendar
     */
    async getCalendar(): Promise<calendarDay[] | []> {
        const data: {calendar: calendarDay[]} | void = await this.#fetch("/calendar/all");
        return data?.calendar ?? [];
    }

    /**
     * Get student's lessons
     * @param {boolean} [today] Boolean to get today's lessons, default true
     * @param {Date} [start] If today is false, the start date of the lessons (defaults to today)
     * @param {Date} [end] If today is false, the end date of the lessons (defaults to today)
     * @returns {object[]} Array of objects containing the student's lessons
     */
    async getLessons(today: boolean = true, start: Date = new Date(), end: Date = new Date()): Promise<any> {
        const data: any = await this.#fetch(`/lessons${today ? "/today" : `/${this.#formatDate(start)}/${this.#formatDate(end)}`}`);
        return data?.lessons ?? [];
    }

    /**
     * Get student's notes
     * @returns {object[]} Array of objects containing the student's notes
     */
    async getNotes(): Promise<any> {
        const data: any = await this.#fetch("/notes/all");
        return data ?? [];
    }

    /**
     * Get student's periods
     * @returns {object[]} Array of objects containing the student's periods
     */
    async getPeriods(): Promise<any> {
        const data: any = await this.#fetch("/periods");
        return data?.periods ?? [];
    }

    /**
     * Get student's subjects
     * @returns {object[]} Array of objects containing the student's subjects
     */
    async getSubjects(): Promise<any> {
        const data: any = await this.#fetch("/subjects");
        return data?.subjects ?? [];
    }

    /**
     * Get student's didactics items
     * @returns {object[]} Array of objects containing the student's didactics items
     */
    async getDidactics(): Promise<any> {
        const data: any = await this.#fetch("/didactics");
        return data?.didacticts ?? [];
    }

    /**
     * Get a list of the Classeviva class' functions
     * @returns {string[]} An array containing the Classeviva class' functions
     */
    getMethods(): string[] {
        return Object.getOwnPropertyNames(Object.getPrototypeOf(this)).filter(prop => prop !== "constructor");
    }

    /**
     * Get a list of the possible parents options for classeviva
     * @returns {object} An object containing all the possible parents options for classeviva
     */
    async getParentsOptions(): Promise<any> {
        const data: any = await this.#fetch("/_options", "GET", "parents");
        return data?.options ?? {};
    }

    /**
     *  Get a list of the avaible talks with teachers on classeviva
     * @returns {object[]} An array of objects containing data about the avaible talks with teachers for classeviva
     */
    async getOverallTalks(): Promise<any> {
        const data: any = await this.#fetch("/overalltalks/list", "GET", "parents");
        return data?.overallTalks ?? [];
    }
    
    /**
     *  Get a list of something regarding the talks with teachers
     * @param {Date} start The start date of the talks (defaults to today)
     * @param {Date} end The end date of the talks (defaults to today)
     * @returns {object[]} An array of objects containing data about the talks with teachers for classeviva
     */
    async getTalks(start: Date = new Date(), end: Date = new Date()): Promise<any> {
        const data: any = await this.#fetch(`/talks/teachersframes/${this.#formatDate(start)}/${this.#formatDate(end)}`, "GET", "parents");
        return data?.teachers ?? [];
    }

    /**
     *  Get auth ticket
     * @returns {object} An object containing data about the auth ticket
     */
    async getTicket(): Promise<TicketResponse | void> {
        if (!this.authorized) return this.#log("Not authorized ❌");

        const headers = Object.assign({ "Z-Auth-Token": this.#token }, this.#headers);
        const res: Response = await fetch(`${this.#baseUrl}/auth/ticket`, {
            headers
        });

        const data: TicketResponse = await res.json()
        .catch(() => this.#log("Could not parse JSON while getting ticket ❌"));

        return data ?? {};
    }

    /**
     *  Get the user avatar
     * @returns {unknown} The user avatar (not tested)
     */
    async getAvatar(): Promise<any> {
        if (!this.authorized) return this.#log("Not authorized ❌");

        const headers = Object.assign({ "Z-Auth-Token": this.#token }, this.#headers);
        const res: Response = await fetch(`${this.#baseUrl}/auth/avatar`, {
            headers
        });

        const data: any = await res.json()
        .catch(() => this.#log("Could not parse JSON while getting avatar ❌"));

        return data ?? {};
    }

    /**
     * Get an overview of the day specified or the time specified
     * @param {Date} start The start date of the overview (defaults to today)
     * @param {Date} end The end date of the overview (defaults to today)
     * @returns {object} An object containing data about the overview of a day or the time specified
     */
    async getOverview(start: Date = new Date(), end: Date = new Date()): Promise<Overview | {}> {
        const data: Overview | void = await this.#fetch(`/overview/all/${this.#formatDate(start)}/${this.#formatDate(end)}`);
        return data ?? {};
    }

    /*/**
     * Not implemented yet 😢
     * @param {string || number} bookingId booking id of the talk
     * @param {string} message message to send
     * @returns {unknown}
     */
    /*async sendTeacherMessage(bookingId: string, message: string) {
        const data: any = await this.#fetch(`/talks/teachermessage/${bookingId}`, "POST", "parents");
        return data ?? {};
    }; */

    /**
     * Read messages from the inbox of a talk
     * @param {string || number} bookingId booking id of the talk
     * @param {string} message message to send
     * @returns {object}
     */
    async readTalkMessage(bookingId: string) {
        const data: any = await this.#fetch(`/talks/teachermessage/${bookingId}`, "POST", "parents", JSON.stringify({"messageRead":true}));
        return data ?? {};
    }

    /**
     * Checks if a document is avaible
     * @param {string | number} hash The hash of the document
     * @returns {object} An object containing data about the document
     */
    async checkDocument(hash: string | number): Promise<checkDocument | {}> {
        const data: checkDocument | void = await this.#fetch(`/documents/check/${hash}/`, "POST");
        return data?.document ?? {};
    }

    /**
     * Book a talk with a teacher
     * @param {string | number} teacherId The id of the teacher
     * @param {string | number} talkId The id of the talk
     * @param {string | number} slot The slot of the talk
     * @param {object} opts contact options
     * @returns {object} An object containing data about the booked talk
     */
    async bookTalk(teacherId: string | number, talkId: string | number, slot: string | number, opts: TalkOptions): Promise<any> {
        const data: any = await this.#fetch(`/talks/book/${teacherId}/${talkId}/${slot}`, "POST", "parents", JSON.stringify(opts));
        return data ?? {};
    }

    /**
     * Get the list of contents that's displayed in the app (should be "Classeviva extra")
     * @param {boolean} common idk, defaults to true
     * @returns {object[]} An array of objects containing data about the contents that's displayed in the app
     */
    async getContents(common = true): Promise<ContentElement[] | [] | void> {
        if (!this.authorized) return this.#log("Not authorized ❌");
        if (!this.user.school?.code) return this.#log("No school code, please update using getCard() or getCards() ❌");

        const headers = Object.assign({ "Z-Auth-Token": this.#token }, this.#headers);
        const response: Response = await fetch(`https://${Enums.Urls[this.#state]}/gek/api/v1/${this.user.school.code}/2021/students/contents?common=${common}`, {
            headers
        });

        const data: ContentElement[] = await response.json()
        .catch(() => this.#log("Could not parse JSON while getting content ❌"));

        return data ?? [];
    }

    /**
     * Get infos about your agreement to the terms of classeviva. If you haven't agreed yet, this response body will be empty and the function will return an empty object.
     * @returns {object} An object containing data about the agreement to the terms of classeviva
     */
    async getTermsAgreement(): Promise<TermsAgreementResponse | {}> {
        const data: TermsAgreementResponse | void = await this.#fetch("/getTermsAgreement", "GET", "users", undefined, true, "userIdent");
        return data ?? {};
    }

    /**
     * Set the agreement to the terms of classeviva third party data colletors
     * @param {boolean} ThirdParty Whether you agree to the terms of classeviva third party data colletors, defaults to true
     * @returns {object} An object with the property "msg": "ok" if the agreement was set successfully
     */
    async setTermsAgreement(ThirdParty: boolean = false): Promise<setTermsAgreementResponse | {}> {
        const accepted = ThirdParty ? "1" : "0";
        const data: setTermsAgreementResponse | void = await this.#fetch("/setTermsAgreement", "POST", "users", JSON.stringify({bitmask: accepted}), true, "userIdent");
        return data ?? {};
    }

    /**
     * Read a notice from the school
     * @param {string} eventCode Event code of the notice
     * @param {string | number} id Id of the notice
     * @param {object} options { sign, join, text }
     * @returns {object} An object containing data about the notice
     */
    async readNotice(eventCode: string, id: string | number, options: readOptions = {}): Promise<readNotice | {}> {
        const data: readNotice | void = await this.#fetch(`/noticeboard/read/${eventCode}/${id}/101`, "POST", "students", options ? JSON.stringify(options) : "", true, "userId", {
            "Content-Type": "application/x-www-form-urlencoded"
        });
        return data ?? {};
    }

    /**
     * Get the document url of a notice attachment
     * @param {string} eventCode Event code of the notice
     * @param {string | number} id Id of the notice
     * @returns {string} The url of the document
     */
    async getNoticeDocumentUrl(eventCode: string, id: string | number): Promise<string | void> {
        if (!this.authorized) return this.#log("Not authorized ❌");

        const headers = Object.assign({ "Z-Auth-Token": this.#token }, this.#headers);
        const response: Response = await fetch(`${this.#baseUrl}/students/${this.user.ident}/noticeboard/attach/${eventCode}/${id}/`, {
            headers
        });

        const url = response.headers.get("Location");
        return url ?? "";
    }

    /**
     * Get the status of a token
     * @param {string} token token to check, defaults to the token of the user
     * @returns {object} An object containing data about the token
     */
    async getTokenStatus(token = this.#token): Promise<TokenStatus | {} | void> {
        if (!this.authorized || !token) return this.#log("Not authorized ❌");

        const headers = Object.assign({ "Z-Auth-Token": token }, this.#headers);
        const response: Response = await fetch(`${this.#baseUrl}/auth/status/`, {
            headers
        });
        const data: TokenStatus = await response.json()
        .catch(() => this.#log("Could not parse JSON while getting token status ❌"));

        return data ?? {};
    }

    /**
     * Read a document
     * @param {string} hash the hash of the document
     * @returns {Buffer} The document
     */
    async readDocument(hash: string): Promise<Buffer> {
        const data: Buffer | void = await this.#fetch(`/documents/read/${hash}/`, "POST", "students", undefined, false);
        return data ?? Buffer.from("");
    }

    /**
     * @private Updates the user object with school infos and the user type
     * @param {object} card The user card (from getCard() or getCards())
     * @return {void} Nothing
     */
    #updateUser(card: Card): void {
        const { schName, schDedication, schCity, schProv, schCode, usrType } = card;
        this.user.type = Enums.UserTypes[usrType || "S"];
        this.user.school = {
            name: schName,
            dedication: schDedication,
            city: schCity,
            province: schProv,
            code: schCode
        };
    }

    /**
     * @private Checks for temp file
     * @returns {boolean} True if there was temp file and it updated the data, false otherwise or in case of an error
     */
    async #checkTemp(): Promise<boolean> {
        try {
            const temp: string = await readFileSync(`${this.#directory}/cvv.json`, "utf8");
            if (!temp) {
                return false;
            }
            const json = JSON.parse(temp);

            if (new Date(json.expire) > new Date()) {
                this.#updateData(json);
                return true;
            } else return false;
        } catch (e) {
            return false;
        }
    }

    /**
     * @private Updates user data
     * @param {object} data user data to update
     * @returns {void}
     */
    #updateData(data: LoginResponse): void {
        if (!data) {
            this.logout();
            return;
        }

        if (typeof data === "object") {
            new Date(data.expire || new Date()) > new Date() ? this.authorized = true : this.authorized = false;
            this.#token = data.token || "";
            this.user = {
                name: data.firstName,
                surname: data.lastName,
                id: this.#removeLetters(data.ident || ""),
                ident: data.ident,
            };
            this.expiration = data.expire || `${new Date().getFullYear()}-${new Date().getMonth()}-${new Date().getDate()}T${new Date().getHours()}:${new Date().getMinutes()}:${new Date().getSeconds()}+01:00`;
            return;
        } else return;

    }

    /**
     * @private Removes letters from a string
     * @param {string} string string to remove letters from
     * @returns {string} string without letters
     */
    #removeLetters(string: string): string {
        return string.replace(/[^0-9]/g, "");
    }

    /**
     * @private Formats date to string in format YYYYMMDD
     * @param {Date} date date to format
     * @returns {string} date in format YYYYMMDD
     */
    #formatDate(date = new Date()): string {
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        return `${year}${month < 10 ? "0" + month : month}${day < 10 ? "0" + day : day}`;
    }

    /**
     * @private Fetch data from the server and the specified endpoint, then returns it
     * @param {string} path api path
     * @param {string} [method] http method
     * @param {string} [type] students | parents
     * @param {string} [body] body to send
     * @param {boolean} [json] if the data should be parsed to json
     * @param {string} [id] user identifier
     * @param {object} [head] additional headers to send
     * @returns {Promise<any>} the response
     */
    async #fetch<TResponse>(path: string = "/", method: FetchMethod = "GET", type: FetchType = "students", body: BodyInit = "", json: boolean = true, id: FetchId = "userId", head: HeadersInit = {}): Promise<TResponse | void> {
        if (!this.authorized) return this.#log("Not logged in ❌");

        const headers: HeadersInit = Object.assign(this.#headers, { "Z-Auth-Token": this.#token, ...head });
        const options: RequestInit = {
            method: method.toUpperCase(),
            headers,
        };
        if (body && method !== "GET") options.body = body;

        const response: Response = await require('node-fetch')(`${this.#baseUrl}/${type}/${id == "userId" ? this.user.id : this.user.ident}${path}`, options);

        const res: FetchResponse = {
            status: response.status,
            data: json ? await response.json() : await response.buffer()
        };

        if (res.data?.error) {
            const { data } = res;
            return this.#log(`An error happened: ${data.message ? data.message : data.error.split('/').pop()} (${data.statusCode}) ❌`);
        }

        if (res.status !== 200) return this.#log(`The server returned a status different from 200 (${res.status}) ❌`);

        return res.data;
    }

    /**
     * @private Logs whatever provided
     * @param  {any[]} args arguments to log
     * @returns {void} log in the console
     */
    #log(...args: any[]): void {
        return console.log(`\x1b[31m[CLASSEVIVA]\x1b[0m`, ...args);
    }
}

export default Rest;