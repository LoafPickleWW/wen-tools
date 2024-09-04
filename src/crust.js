import * as algosdk from "algosdk";

export const appId = 1275319623;

/**
 *       const dryrunRequest = await createDryrun({
 *         client: algodClient,
 *         txns: [{ txn: txn2 }],
 *         apps: [{ id: appId }],
 *       });
 *
 *       const dryRunResult = await algodClient.dryrun(dryrunRequest).do();
 *       console.log('res', dryRunResult.txns[0])
 */
/**
 *       const txn = algosdk.makeApplicationNoOpTxn(
 *           generateAccount().addr,
 *           suggestedParams,
 *           appId,
 *           [new Uint8Array(Buffer.from("get_price")), algosdk.encodeUint64(10000),
 *             new Uint8Array([1])
 *           ],
 *           undefined,undefined,undefined,undefined,undefined,undefined,
 *       );
 * @param client
 * @param size
 * @returns {Promise<number>}
 */
export async function getPrice(client, size) {
    const appInfo = await client.getApplicationByID(appId).do()
    const state = appInfo.params['global-state'];

    console.log(state)
    const getStateValue = function(key) {
        const item = state.find((item) => Buffer.from(item.key, 'base64').toString() === key);
        return item ? item.value.uint : 0;
    };

    const basePrice = getStateValue('base_price');
    const bytePrice = getStateValue('byte_price');
    const serviceRate = getStateValue('service_rate');
    const cruPrice = getStateValue('cru_price');
    const algoPrice = getStateValue('algo_price');

    console.table(basePrice, bytePrice, serviceRate, cruPrice, algoPrice)

    let price = (basePrice + size * bytePrice / (1024) / (1024))
        * (serviceRate + (100)) / (100)
        * cruPrice / algoPrice / (10**12);

    price *= 200;

    return Math.round(price);
}

export async function getRandomNode(client) {
    try {
        const boxesResponse = await client.getApplicationBoxes(appId).do();
        const boxNames = boxesResponse.boxes.map(box => box.name);

        const nodesBoxName = boxNames.find(name =>
            Buffer.from(name, 'base64').toString() === 'nodes'
        );

        if (!nodesBoxName) {
            console.log("Nodes box not found");
            return [];
        }

        const nodesBoxResponse = await client.getApplicationBoxByName(appId, nodesBoxName).do();
        const nodesData = nodesBoxResponse.value;

        const nodes = [];
        for (let i = 0; i < nodesData.length; i += 32) {
            const address = algosdk.encodeAddress(nodesData.slice(i, i + 32));
            nodes.push(address);
        }
        return nodes.filter((node, index) => nodes.indexOf(node) === index)[0];
    } catch (error) {
        console.error("Error fetching nodes:", error);
        return [];
    }
}

