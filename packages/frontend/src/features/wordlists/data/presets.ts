export type WordlistPreset = {
  name: string;
  url: string;
  description: string;
};

export const wordlistPresets: WordlistPreset[] = [
  {
    name: "param-miner/assetnote-params",
    url: "https://raw.githubusercontent.com/PortSwigger/param-miner/master/resources/assetnote-params",
    description: "Parameter list from Assetnote via Param Miner.",
  },
  {
    name: "param-miner/params",
    url: "https://raw.githubusercontent.com/PortSwigger/param-miner/master/resources/params",
    description: "General parameters from Param Miner.",
  },
  {
    name: "param-miner/words",
    url: "https://raw.githubusercontent.com/PortSwigger/param-miner/master/resources/words",
    description: "Common parameter names from Param Miner.",
  },
  {
    name: "param-miner/headers",
    url: "https://raw.githubusercontent.com/PortSwigger/param-miner/master/resources/headers",
    description: "HTTP header names from Param Miner.",
  },
  {
    name: "param-miner/wafparams",
    url: "https://raw.githubusercontent.com/PortSwigger/param-miner/master/resources/wafparams",
    description: "WAF bypass parameters from Param Miner.",
  },
  {
    name: "param-miner/functions",
    url: "https://raw.githubusercontent.com/PortSwigger/param-miner/master/resources/functions",
    description: "Common function names from Param Miner.",
  },
  {
    name: "param-miner/boring_headers",
    url: "https://raw.githubusercontent.com/PortSwigger/param-miner/master/resources/boring_headers",
    description: "Common boring header names from Param Miner.",
  },
  {
    name: "seclists/raft-large-words",
    url: "https://raw.githubusercontent.com/danielmiessler/SecLists/refs/heads/master/Discovery/Web-Content/raft-large-words.txt",
    description: "Large wordlist from SecLists for web content discovery.",
  },
  {
    name: "seclists/raft-medium-words",
    url: "https://raw.githubusercontent.com/danielmiessler/SecLists/refs/heads/master/Discovery/Web-Content/raft-medium-words.txt",
    description: "Medium wordlist from SecLists for web content discovery.",
  },
  {
    name: "seclists/raft-small-words",
    url: "https://raw.githubusercontent.com/danielmiessler/SecLists/refs/heads/master/Discovery/Web-Content/raft-small-words.txt",
    description: "Small SecLists wordlist for quick discovery runs.",
  },
];
