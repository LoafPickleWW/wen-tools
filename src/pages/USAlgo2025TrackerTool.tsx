import { useEffect, useState } from "react";
import { NetworkId, useWallet } from "@txnlab/use-wallet-react";
import { getIndexerURL, sliceIntoChunks, walletSign } from "../utils";
import axios from "axios";
import { TOOLS } from "../constants";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { toast } from "react-toastify";
import algosdk, { AtomicTransactionComposer } from "algosdk";
import ConnectButton from "../components/ConnectButton";

interface StateData {
  name: string;
  id: number;
  unit: string;
  imageUrl: string;
  balance: number;
}

const bronzeStates = [
  {
    name: "Alabama Bronze",
    id: 2689195288,
    unit: "USA 3",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/1_Alabama/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Alaska Bronze",
    id: 2689195294,
    unit: "USA 6",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/2_Alaska/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Arizona Bronze",
    id: 2689195309,
    unit: "USA 9",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/3_Arizona/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Arkansas Bronze",
    id: 2689195325,
    unit: "USA 12",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/4_Arkansas/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "California Bronze",
    id: 2689195353,
    unit: "USA 15",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/5_California/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Colorado Bronze",
    id: 2689195363,
    unit: "USA 18",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/6_Colorado/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Connecticut Bronze",
    id: 2689195370,
    unit: "USA 21",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/7_Connecticut/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Deleware Bronze",
    id: 2689195384,
    unit: "USA 24",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeifii3dsn76qcoligfc556mti3pugz25pmnutp4cf73lcvxibd3u4y?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Florida Bronze",
    id: 2689195394,
    unit: "USA 27",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/9_Florida/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Georgia Bronze",
    id: 2689195400,
    unit: "USA 30",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/10_Georgia/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Hawaii Bronze",
    id: 2689195414,
    unit: "USA 33",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/11_Hawaii/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Idaho Bronze",
    id: 2689195421,
    unit: "USA 36",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/12_Idaho/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Illinois Bronze",
    id: 2689195429,
    unit: "USA 39",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/13_Illinois/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Indiana Bronze",
    id: 2689195435,
    unit: "USA 42",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/14_Indiana/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Iowa Bronze",
    id: 2689195446,
    unit: "USA 45",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/15_Iowa/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Kansas Bronze",
    id: 2689195458,
    unit: "USA 48",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/16_Kansas/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Kentucky Bronze",
    id: 2689195471,
    unit: "USA 51",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/17_Kentucky/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Louisiana Bronze",
    id: 2689195505,
    unit: "USA 54",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/18_Louisiana/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Maine Bronze",
    id: 2689195511,
    unit: "USA 57",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/19_Maine/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Maryland Bronze",
    id: 2689195517,
    unit: "USA 60",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/20_Maryland/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Massachusetts Bronze",
    id: 2689195523,
    unit: "USA 63",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/21_Massachusetts/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Michigan Bronze",
    id: 2689195535,
    unit: "USA 66",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/22_Michigan/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Minnesota Bronze",
    id: 2689195543,
    unit: "USA 69",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/23_Minnesota/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Mississippi Bronze",
    id: 2689195560,
    unit: "USA 72",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/24_Mississippi/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Missouri Bronze",
    id: 2689195571,
    unit: "USA 75",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/25_Missouri/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Montana Bronze",
    id: 2689195580,
    unit: "USA 78",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/26_Montana/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Nebraska Bronze",
    id: 2689195592,
    unit: "USA 81",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/27_Nebraska/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Nevada Bronze",
    id: 2689195600,
    unit: "USA 84",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/28_Nevada/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "New Hampshire Bronze",
    id: 2689195608,
    unit: "USA 87",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/29_New%20Hampshire/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "New Jersey Bronze",
    id: 2689195614,
    unit: "USA 90",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/30_New%20Jersey/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "New Mexico Bronze",
    id: 2689195641,
    unit: "USA 93",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/31_New%20Mexico/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "New York Bronze",
    id: 2689195652,
    unit: "USA 96",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/32_New%20York/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "North Carolina Bronze",
    id: 2689195658,
    unit: "USA 99",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/33_North%20Carolina/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "North Dakota Bronze",
    id: 2689195668,
    unit: "USA 102",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/34_North%20Dakota/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Ohio Bronze",
    id: 2689195676,
    unit: "USA 105",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/35_Ohio/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Oklahoma Bronze",
    id: 2689195717,
    unit: "USA 108",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/36_Oklahoma/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Oregon Bronze",
    id: 2689195729,
    unit: "USA 111",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/37_Oregon/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Pennsylvania Bronze",
    id: 2689195742,
    unit: "USA 114",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/38_Pennsylvania/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Rhode Island Bronze",
    id: 2689195756,
    unit: "USA 117",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/39_Rhode%20Island/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "South Carolina Bronze",
    id: 2689195767,
    unit: "USA 120",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/40_South%20Carolina/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "South Dakota Bronze",
    id: 2689195806,
    unit: "USA 123",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/41_South%20Dakota/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Tennessee Bronze",
    id: 2689195819,
    unit: "USA 126",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/42_Tennessee/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Texas Bronze",
    id: 2689195825,
    unit: "USA 129",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/43_Texas/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Utah Bronze",
    id: 2689195843,
    unit: "USA 132",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/44_Utah/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Vermont Bronze",
    id: 2689195858,
    unit: "USA 135",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/45_Vermont/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Virginia Bronze",
    id: 2689195864,
    unit: "USA 138",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/46_Virginia/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Washington Bronze",
    id: 2689195870,
    unit: "USA 141",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/47_Washington/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "West Virginia Bronze",
    id: 2689195889,
    unit: "USA 144",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/48_West%20Virginia/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Wisconsin Bronze",
    id: 2689195895,
    unit: "USA 147",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/49_Wisconsin/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Wyoming Bronze",
    id: 2689195902,
    unit: "USA 150",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/50_Wyoming/3.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
];

const silverStates = [
  {
    name: "Alabama Silver",
    id: 2689195286,
    unit: "USA 2",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/1_Alabama/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Alaska Silver",
    id: 2689195292,
    unit: "USA 5",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/2_Alaska/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Arizona Silver",
    id: 2689195305,
    unit: "USA 8",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/3_Arizona/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Arkansas Silver",
    id: 2689195322,
    unit: "USA 11",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/4_Arkansas/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "California Silver",
    id: 2689195342,
    unit: "USA 14",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/5_California/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Colorado Silver",
    id: 2689195361,
    unit: "USA 17",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/6_Colorado/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Connecticut Silver",
    id: 2689195367,
    unit: "USA 20",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/7_Connecticut/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Deleware Silver",
    id: 2689195382,
    unit: "USA 23",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeibjkduebg3nqvzhr2j5zumqydjlxgwcluquo34m4sm5fwxcbhrmqi?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Florida Silver",
    id: 2689195392,
    unit: "USA 26",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/9_Florida/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Georgia Silver",
    id: 2689195398,
    unit: "USA 29",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/10_Georgia/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Hawaii Silver",
    id: 2689195406,
    unit: "USA 32",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/11_Hawaii/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Idaho Silver",
    id: 2689195419,
    unit: "USA 35",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/12_Idaho/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Illinois Silver",
    id: 2689195427,
    unit: "USA 38",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/13_Illinois/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Indiana Silver",
    id: 2689195433,
    unit: "USA 41",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/14_Indiana/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Iowa Silver",
    id: 2689195441,
    unit: "USA 44",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/15_Iowa/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Kansas Silver",
    id: 2689195454,
    unit: "USA 47",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/16_Kansas/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Kentucky Silver",
    id: 2689195469,
    unit: "USA 50",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/17_Kentucky/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Louisiana Silver",
    id: 2689195495,
    unit: "USA 53",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/18_Louisiana/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Maine Silver",
    id: 2689195509,
    unit: "USA 56",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/19_Maine/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Maryland Silver",
    id: 2689195515,
    unit: "USA 59",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/20_Maryland/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Massachusetts Silver",
    id: 2689195521,
    unit: "USA 62",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/21_Massachusetts/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Michigan Silver",
    id: 2689195531,
    unit: "USA 65",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/22_Michigan/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Minnesota Silver",
    id: 2689195541,
    unit: "USA 68",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/23_Minnesota/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Mississippi Silver",
    id: 2689195548,
    unit: "USA 71",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/24_Mississippi/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Missouri Silver",
    id: 2689195569,
    unit: "USA 74",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/25_Missouri/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Montana Silver",
    id: 2689195578,
    unit: "USA 77",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/26_Montana/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Nebraska Silver",
    id: 2689195590,
    unit: "USA 80",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/27_Nebraska/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Nevada Silver",
    id: 2689195596,
    unit: "USA 83",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/28_Nevada/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "New Hampshire Silver",
    id: 2689195604,
    unit: "USA 86",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/29_New%20Hampshire/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "New Jersey Silver",
    id: 2689195612,
    unit: "USA 89",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/30_New%20Jersey/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "New Mexico Silver",
    id: 2689195633,
    unit: "USA 92",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/31_New%20Mexico/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "New York Silver",
    id: 2689195649,
    unit: "USA 95",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/32_New%20York/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "North Carolina Silver",
    id: 2689195656,
    unit: "USA 98",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/33_North%20Carolina/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "North Dakota Silver",
    id: 2689195666,
    unit: "USA 101",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/34_North%20Dakota/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Ohio Silver",
    id: 2689195674,
    unit: "USA 104",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/35_Ohio/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Oklahoma Silver",
    id: 2689195688,
    unit: "USA 107",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/36_Oklahoma/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Oregon Silver",
    id: 2689195723,
    unit: "USA 110",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/37_Oregon/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Pennsylvania Silver",
    id: 2689195740,
    unit: "USA 113",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/38_Pennsylvania/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Rhode Island Silver",
    id: 2689195749,
    unit: "USA 116",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/39_Rhode%20Island/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "South Carolina Silver",
    id: 2689195765,
    unit: "USA 119",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/40_South%20Carolina/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "South Dakota Silver",
    id: 2689195772,
    unit: "USA 122",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/41_South%20Dakota/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Tennessee Silver",
    id: 2689195817,
    unit: "USA 125",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/42_Tennessee/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Texas Silver",
    id: 2689195823,
    unit: "USA 128",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/43_Texas/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Utah Silver",
    id: 2689195829,
    unit: "USA 131",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/44_Utah/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Vermont Silver",
    id: 2689195856,
    unit: "USA 134",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/45_Vermont/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Virginia Silver",
    id: 2689195862,
    unit: "USA 137",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/46_Virginia/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Washington Silver",
    id: 2689195868,
    unit: "USA 140",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/47_Washington/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "West Virginia Silver",
    id: 2689195879,
    unit: "USA 143",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/48_West%20Virginia/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Wisconsin Silver",
    id: 2689195893,
    unit: "USA 146",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/49_Wisconsin/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Wyoming Silver",
    id: 2689195900,
    unit: "USA 149",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/50_Wyoming/2.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
];

const goldStates = [
  {
    name: "Alabama Gold",
    id: 2689195279,
    unit: "USA 1",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/1_Alabama/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Alaska Gold",
    id: 2689195290,
    unit: "USA 4",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/2_Alaska/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Arizona Gold",
    id: 2689195296,
    unit: "USA 7",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/3_Arizona/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Arkansas Gold",
    id: 2689195318,
    unit: "USA 10",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/4_Arkansas/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "California Gold",
    id: 2689195339,
    unit: "USA 13",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/5_California/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Colorado Gold",
    id: 2689195359,
    unit: "USA 16",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/6_Colorado/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Connecticut Gold",
    id: 2689195365,
    unit: "USA 19",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/7_Connecticut/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Deleware Gold",
    id: 2689195373,
    unit: "USA 22",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeidv4rare35fst3dwpijwortxlnjls57chqmq5nf2xerbzeblozyki?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Florida Gold",
    id: 2689195386,
    unit: "USA 25",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/9_Florida/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Georgia Gold",
    id: 2689195396,
    unit: "USA 28",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/10_Georgia/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Hawaii Gold",
    id: 2689195404,
    unit: "USA 31",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/11_Hawaii/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Idaho Gold",
    id: 2689195416,
    unit: "USA 34",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/12_Idaho/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Illinois Gold",
    id: 2689195423,
    unit: "USA 37",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/13_Illinois/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Indiana Gold",
    id: 2689195431,
    unit: "USA 40",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/14_Indiana/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Iowa Gold",
    id: 2689195439,
    unit: "USA 43",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/15_Iowa/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Kansas Gold",
    id: 2689195448,
    unit: "USA 46",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/16_Kansas/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Kentucky Gold",
    id: 2689195460,
    unit: "USA 49",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/17_Kentucky/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Louisiana Gold",
    id: 2689195476,
    unit: "USA 52",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/18_Louisiana/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Maine Gold",
    id: 2689195507,
    unit: "USA 55",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/19_Maine/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Maryland Gold",
    id: 2689195513,
    unit: "USA 58",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/20_Maryland/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Massachusetts Gold",
    id: 2689195519,
    unit: "USA 61",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/21_Massachusetts/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Michigan Gold",
    id: 2689195525,
    unit: "USA 64",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/22_Michigan/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Minnesota Gold",
    id: 2689195537,
    unit: "USA 67",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/23_Minnesota/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Mississippi Gold",
    id: 2689195546,
    unit: "USA 70",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/24_Mississippi/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Missouri Gold",
    id: 2689195567,
    unit: "USA 73",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/25_Missouri/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Montana Gold",
    id: 2689195574,
    unit: "USA 76",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/26_Montana/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Nebraska Gold",
    id: 2689195582,
    unit: "USA 79",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/27_Nebraska/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Nevada Gold",
    id: 2689195594,
    unit: "USA 82",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/28_Nevada/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "New Hampshire Gold",
    id: 2689195602,
    unit: "USA 85",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/29_New%20Hampshire/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "New Jersey Gold",
    id: 2689195610,
    unit: "USA 88",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/30_New%20Jersey/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "New Mexico Gold",
    id: 2689195623,
    unit: "USA 91",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/31_New%20Mexico/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "New York Gold",
    id: 2689195643,
    unit: "USA 94",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/32_New%20York/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "North Carolina Gold",
    id: 2689195654,
    unit: "USA 97",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/33_North%20Carolina/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "North Dakota Gold",
    id: 2689195664,
    unit: "USA 100",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/34_North%20Dakota/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Ohio Gold",
    id: 2689195670,
    unit: "USA 103",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/35_Ohio/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Oklahoma Gold",
    id: 2689195686,
    unit: "USA 106",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/36_Oklahoma/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Oregon Gold",
    id: 2689195719,
    unit: "USA 109",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/37_Oregon/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Pennsylvania Gold",
    id: 2689195738,
    unit: "USA 112",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/38_Pennsylvania/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Rhode Island Gold",
    id: 2689195744,
    unit: "USA 115",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/39_Rhode%20Island/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "South Carolina Gold",
    id: 2689195763,
    unit: "USA 118",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/40_South%20Carolina/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "South Dakota Gold",
    id: 2689195769,
    unit: "USA 121",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/41_South%20Dakota/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Tennessee Gold",
    id: 2689195808,
    unit: "USA 124",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/42_Tennessee/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Texas Gold",
    id: 2689195821,
    unit: "USA 127",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/43_Texas/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Utah Gold",
    id: 2689195827,
    unit: "USA 130",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/44_Utah/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Vermont Gold",
    id: 2689195850,
    unit: "USA 133",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/45_Vermont/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Virginia Gold",
    id: 2689195860,
    unit: "USA 136",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/46_Virginia/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Washington Gold",
    id: 2689195866,
    unit: "USA 139",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/47_Washington/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "West Virginia Gold",
    id: 2689195877,
    unit: "USA 142",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/48_West%20Virginia/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Wisconsin Gold",
    id: 2689195891,
    unit: "USA 145",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/49_Wisconsin/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
  {
    name: "Wyoming Gold",
    id: 2689195897,
    unit: "USA 148",
    imageUrl:
      "https://ipfs.algonode.dev/ipfs//bafybeigselnltp2fopatwymlgjcynxyu5y73sutwapbdxbblpyxxugr2xm/USA%20States/50_Wyoming/1.jpg?optimizer=image&width=450&quality=70",
    balance: 0,
  },
];

const creatorAddress =
  "USAHT24VO35GF4IBMKKBPJGBPHEY2I2YBBYUGVPLWEOZAE7ATSPNG3Q274";

export const USAlgo2025TrackerTool = () => {
  const { activeNetwork, activeAccount, algodClient, transactionSigner } =
    useWallet();
  const [alignment, setAlignment] = useState<"bronze" | "silver" | "gold">(
    "bronze"
  );
  const [noOfSets, setNoOfSets] = useState(0);
  const [assets, setAssets] = useState<{
    bronze: StateData[];
    silver: StateData[];
    gold: StateData[];
  }>({ bronze: bronzeStates, silver: silverStates, gold: goldStates });
  const [canClaim, setCanClaim] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);

  const handleChange = (
    _: React.MouseEvent<HTMLElement>,
    newAlignment: "bronze" | "silver" | "gold"
  ) => {
    console.log(newAlignment);
    setAlignment(newAlignment);
  };

  useEffect(() => {
    if(alignment){
    const canClaim = assets[alignment].every((state) => state.balance > 0);
    setCanClaim(canClaim);
    }else{
      setCanClaim(false);
    }
  }, [assets, alignment]);

  useEffect(() => {
    const fetchUserAssets = async (address: string) => {
      let threshold = 1000;
      const userAssets = await axios.get(
        `${getIndexerURL(activeNetwork)}/v2/accounts/${address}/assets`
      );
      while (userAssets.data.assets.length === threshold) {
        const nextAssets = await axios.get(
          `${getIndexerURL(activeNetwork)}/v2/accounts/${address}/assets?next=${
            userAssets.data["next-token"]
          }`
        );
        userAssets.data.assets = userAssets.data.assets.concat(
          nextAssets.data.assets
        );
        userAssets.data["next-token"] = nextAssets.data["next-token"];
        threshold += 1000;
      }
      const assets: { assetId: number; amount: number }[] =
        userAssets.data.assets
          .filter((asset: any) => asset.amount > 0)
          .map((asset: any) => {
            return {
              assetId: Number(asset["asset-id"]),
              amount: Number(asset.amount),
            };
          });
      const assetsData = {
        bronze: bronzeStates.map((state) => {
          const asset = assets.find((asset) => asset.assetId === state.id);
          return {
            ...state,
            balance: asset ? asset.amount : 0,
          };
        }),
        silver: silverStates.map((state) => {
          const asset = assets.find((asset) => asset.assetId === state.id);
          return {
            ...state,
            balance: asset ? asset.amount : 0,
          };
        }),
        gold: goldStates.map((state) => {
          const asset = assets.find((asset) => asset.assetId === state.id);
          return {
            ...state,
            balance: asset ? asset.amount : 0,
          };
        }),
      };
      setAssets(assetsData);
    };
    if (activeAccount) {
      fetchUserAssets(activeAccount.address);
    }
  }, [activeAccount, activeNetwork]);

  const claim = async () => {
    if (!activeAccount) {
      toast.error("Please connect your wallet to redeem the reward");
      return;
    }
    if (noOfSets < 1) {
      toast.error("Please enter a valid number of sets to redeem");
      return;
    }

    if (!assets[alignment].every((state) => state.balance >= noOfSets)) {
      toast.error("You do not have enough assets to redeem");
      return;
    }

    setIsClaiming(true);
    try {
      const assetIds = assets[alignment].map((state) => state.id);
      // Split assetIds into chunks of 16
      const assetIdArrays = Array.from(
        { length: Math.ceil(assetIds.length / 16) },
        (_, i) => assetIds.slice(i * 16, (i + 1) * 16)
      );
      const suggestedParams = await algodClient.getTransactionParams().do();
      let assetTxns = [];
      for (const assetIdArray of assetIdArrays) {
        const composer = new AtomicTransactionComposer();
        for (const assetId of assetIdArray) {
          composer.addTransaction({
            txn: algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
              from: activeAccount.address,
              to: creatorAddress,
              assetIndex: assetId,
              amount: noOfSets,
              suggestedParams,
            }),
            signer: transactionSigner,
          });
        }
        composer.buildGroup();
        assetTxns.push(composer.buildGroup().flat());
      }

      assetTxns = assetTxns.flat().map((txn) => txn.txn);

      const flat = await walletSign(assetTxns, transactionSigner);
      const signedTransactions = sliceIntoChunks(flat, 16);
      for (let i = 0; i < signedTransactions.length; i++) {
        try {
          await algodClient.sendRawTransaction(signedTransactions[i]).do();
          if (i + (1 % 5) === 0) {
            toast.success(`Transaction ${i + 1} of ${flat.length} confirmed!`, {
              autoClose: 1000,
            });
          }
        } catch (err) {
          console.error(err);
          toast.error(`Transaction ${i + 1} of ${flat.length} failed!`, {
            autoClose: 1000,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      toast.success("Redeem successful!");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      window.location.reload();
    } catch (e: any) {
      console.error(e);
      toast.error(`Error while redeeming: ${e.message}`);
    } finally {
      setIsClaiming(false);
    }
  };

  return (
    <div className="mx-auto text-white mb-4 mt-4 text-center flex flex-col items-center max-w-full gap-y-2 min-h-screen">
      <h1 className="text-2xl font-bold mt-6">
        {TOOLS.find((tool) => tool.path === window.location.pathname)?.label}
      </h1>
      <ConnectButton inmain={true} />
      <p className="text-md text-gray-200">
        {
          TOOLS.find((tool) => tool.path === window.location.pathname)
            ?.description
        }
      </p>

      {activeAccount && activeNetwork === NetworkId.MAINNET && (
        <>
          <ToggleButtonGroup
            color="warning"
            className="bg-white mt-4"
            value={alignment}
            exclusive
            onChange={handleChange}
            aria-label="Platform"
          >
            <ToggleButton value="gold">Gold</ToggleButton>
            <ToggleButton value="silver">Silver</ToggleButton>
            <ToggleButton value="bronze">Bronze</ToggleButton>
          </ToggleButtonGroup>

          <div className="flex flex-col items-center gap-y-4 mt-4">
            {alignment &&
              assets[alignment].map((state) => (
                <div
                  key={state.id}
                  className={`flex flex-row items-center justify-between gap-x-4 p-4 rounded-lg min-w-full ${
                    state.balance > 0
                      ? "bg-orange-200 text-black"
                      : "bg-gray-800"
                  }`}
                >
                  <div className="flex flex-row items-center gap-x-4">
                    <img
                      src={state.imageUrl}
                      alt={state.name}
                      className="rounded-lg w-32"
                    />
                    <div className="flex flex-col items-start gap-y-1">
                      <p title="Asset Name" className="text-md font-bold">
                        {state.name}
                      </p>
                      <p title="Unit Name" className="text-sm">
                        {state.unit}
                      </p>
                    </div>
                  </div>

                  <div title="Holdings" className="justify-self-end">
                    <p className="text-md font-bold">#{state.balance}</p>
                  </div>
                </div>
              ))}
            {!alignment && (
              <div className="text-center text-orange-400 animate-pulse mt-4">
                <p>Select a Set</p>
              </div>
            )}
          </div>
        </>
      )}

      {canClaim && (
        <>
          <div className="flex flex-col rounded border-gray-300  dark:border-gray-700 mt-4">
            <label className="text-xs text-slate-400">No. of Set(s)</label>
            <input
              type="number"
              min="0"
              placeholder="N"
              className="bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-1 text-sm mx-auto placeholder:text-center placeholder:text-sm"
              style={{ width: "10rem" }}
              value={noOfSets}
              onChange={(e) => {
                setNoOfSets(Number(e.target.value));
              }}
            />
          </div>
          <button
            className={`rounded text-lg bg-secondary-orange hover:bg-secondary-orange/80 transition text-black font-semibold px-4 py-1 mt-2 ${
              isClaiming ? "opacity-50 cursor-not-allowed" : ""
            }`}
            onClick={() => claim()}
            disabled={isClaiming}
          >
            Redeem
          </button>
        </>
      )}
      {isClaiming && (
        <div className="mx-auto flex flex-col">
          <div
            className="spinner-border animate-spin inline-block mx-auto mt-4 mb-2 w-8 h-8 border-4 rounded-full"
            role="status"
          />
          <span>Sending 50 Assets To Creator Wallet...</span>
        </div>
      )}

      {(!activeAccount || activeNetwork !== NetworkId.MAINNET) && (
        <div className="text-center text-orange-400 animate-pulse mt-4">
          {!activeAccount && (
            <p>Please Connect your wallet to view your assets</p>
          )}
          {activeNetwork !== NetworkId.MAINNET && (
            <p>Please Switch to Mainnet to use this Tool</p>
          )}
        </div>
      )}
    </div>
  );
};
