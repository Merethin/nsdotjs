export class RateLimiter {
    private rateLimitAvailable: number;
	private rateLimitRemaining: number;
    private rateLimitReset: number;
    private resetRateLimit: Timer | null;
    private scriptName: string;
	private scriptVersion: string;
	private scriptAuthor: string;
    private currentUser: string;

    constructor(
        name: string,
        version: string,
        author: string,
        user: string,
    ) {
        this.scriptName = name;
        this.scriptVersion = version;
        this.scriptAuthor = author;
        this.currentUser = user;
        this.rateLimitAvailable = 50; // API says not to assume this, we'll check the actual value after first request
        this.rateLimitRemaining = 50; // We'll check the actual value when making a request
        this.rateLimitReset = 0; // We'll check the actual value when making a request
        this.resetRateLimit = null;
    }

    /**
	 * Decides which NationStates domain to send requests to.
	 * @returns fast.nationstates.net if on the fast site, www.nationstates.net otherwise.
	 */
	private getRequestDomain(): string {
		if(window.location.host == "fast.nationstates.net") return "fast.nationstates.net";
		return "www.nationstates.net";
	}

    public async makeRequest(url: string, payload?: Record<string, string | number | boolean>): Promise<Response> {
        const baseUrl = `https://${this.getRequestDomain()}/`;

        // Construct the value for the 'script' parameter
        const scriptParamValue = `${this.scriptName} v${this.scriptVersion} by ${this.scriptAuthor} in use by ${this.currentUser}`;
        const requestParams = new URLSearchParams();
        requestParams.append("script", scriptParamValue);

        if (payload) {
            Object.entries(payload).forEach(([key, value]) => {
                requestParams.append(key, String(value));
            });
        }

        // if this timer is still running, stop it since we'll get updated info on the rate limit status after sending the request
        if(this.resetRateLimit) {
            clearTimeout(this.resetRateLimit);
            this.resetRateLimit = null;
        }

        let unixTime = Math.floor(Date.now() / 1000);

        if(this.rateLimitRemaining < 3 && unixTime < this.rateLimitReset) {
            console.log(`rate limit: ${this.rateLimitRemaining} left as of last check, pausing`);
            await new Promise(r => setTimeout(r, (this.rateLimitReset - unixTime) * 1000));
        }

        let requestUrl = new URL(url, baseUrl);
        requestUrl.search = requestParams.toString();

        while(true) {
            let response = await fetch(requestUrl.toString(), {
                credentials: "include",
                method: "GET",
                redirect: "manual",
            });

            // Rate limit hit
            if(response.status == 429) {
                let retryAfter = parseInt(response.headers.get('Retry-After') as string);
                console.log(`rate limit hit, retrying after ${retryAfter} seconds`);
                await new Promise(r => setTimeout(r, retryAfter * 1000));
                continue;
            }

            this.rateLimitAvailable = parseInt(response.headers.get('RateLimit-Limit') as string);
            this.rateLimitRemaining = parseInt(response.headers.get('RateLimit-Remaining') as string);
            let secondsToReset = parseInt(response.headers.get('RateLimit-Reset') as string);
            this.rateLimitReset = Math.floor(Date.now() / 1000) + secondsToReset;

            console.log(`rate limit: ${this.rateLimitAvailable} limit, ${this.rateLimitRemaining} left, ${this.rateLimitReset} reset`);

            this.resetRateLimit = setTimeout(() => {
                this.resetRateLimit = null;
                this.rateLimitRemaining = this.rateLimitAvailable;
                console.log(`rate limit bucket reset: back to ${this.rateLimitAvailable}`);
            }, secondsToReset * 1000);

            return response;
        }
    }
}