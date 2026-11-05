# Solo DND Project

This repository is solo DND application given you the ability to create characters, roll dices and play along an AI dungeon master.


## Setup

This section shows how to build your image and run a container for that image.

create a .env file here is a template:
```
MONGO_INITDB_ROOT_USERNAME=admin
MONGO_INITDB_ROOT_PASSWORD=password
MONGO_APP_USER=Joe
MONGO_APP_PASS=4321
```

for Linux:
```bash
    $ ./deploy/init
```
for Windows:
```
    $ bash ./deploy/init
```


## Helm

The Helm will be coming soon.

##  Directory Structure

```
└── DND-solo/                              # project's root directory.
    ├─backend/                      
    │   ├──  RAGdata/                       # contains raw documents for the RAG to proccess
    │   ├──  dnd_races_index/               # processed vector database for the RAG to use.
    │   ├──  dockerfile                     # building container for the backend
    │   ├──  model.py                       # contains the llm with RAG framework
    │   ├──  requirements.txt               # server module requirements
    │   ├──  server.py                      # main to run the fastapi server
    │   └──  utils.py                       # utils for model
    ├── deploy/                             # deploy app
    │   ├── charts/                         # helm charts (TBA)
    │   ├── .env                            # environment file
    │   ├── docker-compose.yml              # compose dockers
    │   ├── init.sh                         # initialization of the application
    │   ├── mongo-init.sh                   # mongo shell script to setup the database
    │   ├── shutdown.sh                     # shutdown of the application (removal)
    │   └── stop.sh                         # stop the application
    ├── frontend/                           
 	  │   ├── DND_page                        # typescript + react
   	│   └── dockerfile                      # building container for the frontend
    └──  README.md                      # description
	
```
