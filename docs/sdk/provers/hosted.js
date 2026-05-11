export class HostedProver {
    url;
    constructor(url) {
        this.url = url;
    }
    async prove(params) {
        const form = new FormData();
        form.append("eml", new Blob([params.eml], { type: "message/rfc822" }), "recovery.eml");
        form.append("newPublicKey", params.newOwner);
        form.append("nonce", params.nonce.toString());
        const resp = await fetch(`${this.url}/prove`, {
            method: "POST",
            body: form,
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: resp.statusText }));
            throw new Error(`Prover error: ${err.error ?? resp.statusText}`);
        }
        return resp.json();
    }
}
//# sourceMappingURL=hosted.js.map