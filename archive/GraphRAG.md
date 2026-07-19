\# tactiq.io free youtube transcript  
\# GraphRAG: Building a Smarter AI System (full walkthrough)  
\# https://www.youtube.com/watch/JTVx6i6MzVw

00:00:00.000 Knowledge graphs aren't just fancy way  
00:00:02.120 to represent information, they are a  
00:00:04.320 powerful way to help AI actually reason  
00:00:07.240 over it. In today's video, we're  
00:00:08.880 building a graph rack system to ask  
00:00:11.080 question and understand the topic of AI  
00:00:13.440 copyright. This topic is a mess and I  
00:00:15.560 mean that in the most interesting way  
00:00:17.440 possible. It's one of the complex topics  
00:00:19.720 that everyone talks about but no one  
00:00:21.720 actually understand what's going on. The  
00:00:23.480 information isn't sitting in one place,  
00:00:25.720 it's scattered across hundreds of news  
00:00:27.800 articles, court filings, policy  
00:00:30.000 documents and hot takes published across  
00:00:32.360 the web. So in this video, we are going  
00:00:34.120 to build a system that scripts that  
00:00:36.320 information live from Google News, turns  
00:00:38.720 it into a structured knowledge graph and  
00:00:40.800 then use graph rack to ask questions no  
00:00:43.720 search engine or standard AI could  
00:00:46.240 reliably answer. For example, which  
00:00:48.720 companies are the center of these  
00:00:50.760 disputes and how are they all connected?  
00:00:53.240 By the end of this video, you know  
00:00:55.000 exactly what graph rack is, why it got  
00:00:57.640 all the hype, how it works and when to  
00:01:00.200 use it. And finally, I'll show you how  
00:01:02.400 to build it yourself on a real complex  
00:01:05.000 document data set you may have. I'll  
00:01:06.800 share a code walk through later in this  
00:01:08.800 video for this project. Before we jump  
00:01:10.840 in, a quick thanks to Serb API for  
00:01:13.000 sponsoring this video. Serb API is what  
00:01:15.640 we're using to script Google News  
00:01:17.600 results for our data set in this  
00:01:19.520 project. It gives you real-time  
00:01:21.440 structured clean search results from  
00:01:23.720 Google and other search engines through  
00:01:25.960 a simple API. So no browser automation  
00:01:28.960 needed and trust me, that makes your  
00:01:31.000 life a lot easier. I'll link it in  
00:01:33.000 description below for you to check out.  
00:01:34.920 Let's get into it. Now, let's start with  
00:01:36.720 a quick recap of how standard or naive  
00:01:39.200 rack retrieval augmented generation  
00:01:41.600 works because understanding its  
00:01:43.320 limitations is what makes graph rack  
00:01:45.920 click. In a typical rack pipeline, you  
00:01:48.280 take your documents, so PDFs, articles,  
00:01:51.160 text files, transcripts and split them  
00:01:53.520 into chunks. Each chunk gets converted  
00:01:55.960 into a numerical vector using an  
00:01:58.680 embedding model. These vectors capture  
00:02:01.440 the meaning of the text, so chunks about  
00:02:04.360 similar topics end up close together in  
00:02:07.440 what we call the vector space. Then,  
00:02:09.440 when a user asks a question, the system  
00:02:11.760 converts that question into a vector,  
00:02:14.240 too, finds the chunks closest to it, and  
00:02:17.040 pulls those chunks and feed them into  
00:02:19.480 the LLM as context. And the LLM then  
00:02:22.760 generates an answer based on the  
00:02:24.640 question and the context that it was  
00:02:26.560 given. This system is great because it  
00:02:28.760 allows the LLM to answer questions about  
00:02:31.280 data it was never trained on. Things  
00:02:33.680 like your company's internal documents,  
00:02:35.959 your research papers, your customer  
00:02:38.160 tickets, whatever. But here's the  
00:02:40.400 problem. As you have more and more data,  
00:02:42.760 the accuracy drops. One study found that  
00:02:45.200 vector search accuracy starts degrading  
00:02:48.080 at just 10,000 pages, reaching a 12%  
00:02:51.640 accuracy drop by 100,000 pages. The more  
00:02:55.160 documents you add, the more overlap you  
00:02:57.680 get in the embedding space, and the  
00:02:59.600 harder it becomes for the system to  
00:03:01.760 retrieve the right chunks. But scaling  
00:03:04.320 isn't even the main issue. Standard RAG  
00:03:06.760 has two more fundamental blind spots.  
00:03:09.320 The number one is each chunk is treated  
00:03:11.760 as an isolated fragment. Once documents  
00:03:14.600 are split and embedded, every chunk  
00:03:16.959 exists on its own, disconnected from the  
00:03:19.480 chunks around it and from related  
00:03:21.560 information in other documents. The  
00:03:23.840 system may find text that sounds related  
00:03:26.519 to your question, but has no  
00:03:28.440 understanding of how those fragments  
00:03:30.760 connect to form a complete picture. The  
00:03:33.519 blind spot number two of the standard  
00:03:35.360 RAG system is that it has no ability to  
00:03:37.959 reason across documents. When an answer  
00:03:40.400 requires linking information scattered  
00:03:42.880 across multiple sources, or when the  
00:03:45.440 question is about the data set as a  
00:03:47.800 whole, like what are the main legal  
00:03:50.320 arguments around this topic, or what are  
00:03:52.720 the main themes emerge from these  
00:03:54.560 documents, then standard RAG has no  
00:03:56.960 mechanism for it. This is the problem  
00:03:59.560 GraphRAG was built to solve. GraphRAG  
00:04:02.080 adds a structural layer on top. Here's a  
00:04:04.440 core idea. It uses an LLM to read each  
00:04:07.280 chunk and extract the entities, for  
00:04:09.680 example, people, companies,  
00:04:12.000 technologies, events, legal cases, and  
00:04:15.240 the relationships between them. These  
00:04:17.440 entities become nodes in a knowledge  
00:04:19.358 graph, and the relationships become  
00:04:21.600 edges connecting them. The result is a  
00:04:23.640 structured graph of your entire data set  
00:04:26.320 that reflects how the information  
00:04:28.160 actually relates across documents.  
00:04:30.640 Microsoft Research, who originally  
00:04:32.680 published the GraphRAG paper, calls this  
00:04:35.560 sense-making, the ability to understand  
00:04:38.080 connections, patterns, and themes across  
00:04:41.240 a large body of information, rather than  
00:04:43.520 just retrieving isolated facts. Using a  
00:04:46.280 knowledge graph has been shown to  
00:04:48.040 improve LLM response accuracy. Now, I  
00:04:50.800 want to be clear with you about  
00:04:51.880 something. GraphRAG doesn't replace  
00:04:54.120 standard vector RAG. They're good at  
00:04:56.400 different things. Here's the simple  
00:04:58.000 rule. I'd use GraphRAG when you're  
00:05:00.000 working with hundreds or thousands of  
00:05:02.400 interconnected documents, or questions  
00:05:04.520 require connecting facts, tracing  
00:05:06.520 relationships, or identifying patterns,  
00:05:09.040 or you need big picture answers, for  
00:05:11.640 example, themes, trends, summaries  
00:05:14.160 across an entire data set. You also want  
00:05:16.480 transparency and ability. You need to  
00:05:18.480 trace how the system arrived at an  
00:05:20.919 answer. And so, in general, using  
00:05:22.840 GraphRAG approach for your Q\&amp;A system  
00:05:25.360 makes sense if you are working in domain  
00:05:27.919 like law, policy, or research, where  
00:05:30.840 accuracy on complex queries is critical.  
00:05:33.680 On the other hand, you can use standard  
00:05:35.480 vector RAG when the questions are direct  
00:05:38.600 fact lookups. For example, when was this  
00:05:40.960 law passed, or who filed this lawsuit?  
00:05:43.880 Also, when the answer lives inside a  
00:05:46.240 single document or chunk and speed and  
00:05:48.880 cost are the priority and your data set  
00:05:51.480 is small and doesn't have dense across  
00:05:54.440 document relationships. All right, now  
00:05:56.440 let's get into how graph rag actually  
00:05:58.960 works under the hood. There are two main  
00:06:01.120 phases in a graph rag system. The first  
00:06:03.400 one is indexing where you build the  
00:06:05.480 knowledge graph from your database and  
00:06:07.640 the second one is querying where you  
00:06:09.760 actually retrieve information from it.  
00:06:12.000 This is a general pipeline. Microsoft's  
00:06:14.480 approach which our project follows  
00:06:16.760 extends it into two additional steps.  
00:06:19.520 So, community detection, we are grouping  
00:06:21.919 related entities into clusters and the  
00:06:24.640 other step is community summarization  
00:06:27.200 where we generate our LM summaries for  
00:06:30.000 each cluster or each community. At query  
00:06:32.880 time, these summaries are queried  
00:06:35.040 instead of the raw graph which is what  
00:06:37.080 makes it particularly effective and fast  
00:06:40.000 for big picture questions. All right,  
00:06:42.320 let's head over to VS Code and I'll show  
00:06:44.760 you step-by-step how this project works.  
00:06:47.160 In this project, I've prepared two  
00:06:48.800 Jupiter notebooks. The first one is  
00:06:50.560 script\_info.ipynb.  
00:06:52.880 This is where we script information the  
00:06:55.960 Google search results for this topic, AI  
00:06:58.640 copyright and governance and the other  
00:07:01.080 notebook is solely dedicated to  
00:07:04.000 implementing the graph rag pipeline. So,  
00:07:07.200 let me walk you through first how I  
00:07:09.360 script the Google search results with  
00:07:12.080 SerpApi. SerpApi is really cool. If you  
00:07:15.040 look at their website and look at the  
00:07:17.320 APIs here, there's a list of all  
00:07:19.880 different kinds of APIs that you can use  
00:07:22.240 to collect data from the web. So, this  
00:07:24.560 is going to be really, really handy if  
00:07:27.160 you want to collect data yourself on any  
00:07:29.480 topic out there. In my case, I'm going  
00:07:31.560 to use Google search API and here's the  
00:07:34.440 playground where you can test out for  
00:07:36.720 free. So, for example, if I search a  
00:07:40.080 query, for example, how to make  
00:07:43.120 cappuccino. Here's the location and we  
00:07:46.080 don't need to select the location. So,  
00:07:48.160 let's search for this query. And here  
00:07:51.680 you can see there's a bunch of search  
00:07:54.000 results that that comes back. And here's  
00:07:56.480 the rest of the search results. And you  
00:07:59.360 can see that there's a bunch of  
00:08:01.240 websites. And on the right side, we can  
00:08:03.240 see this is the JSON response that we  
00:08:06.240 would get if we call the API for this  
00:08:08.960 search query. So, the API has a free so  
00:08:11.560 you can try it out for free. In my case,  
00:08:13.440 I have a free plan as well and you can  
00:08:16.160 generate your own API key for your  
00:08:18.760 project. All right, back to the project.  
00:08:21.200 First, I'm going to install some  
00:08:22.600 dependencies for this project. So, the  
00:08:24.919 three big ones here  
00:08:27.360 firstly Google search results. So, this  
00:08:29.600 is the Python client for Serp API.  
00:08:32.400 That's the service that lets us search  
00:08:34.440 Google programmatically. And next we  
00:08:37.360 have the Trafilatura.  
00:08:40.919 This is a library we use for extracting  
00:08:44.720 article text from web pages and YouTube  
00:08:48.400 transcript API which grabs transcripts  
00:08:50.880 from YouTube videos. So, these are the  
00:08:52.839 main libraries that we'll be using.  
00:08:54.720 Next, we go to the imports and  
00:08:57.360 configuration. So, here are just  
00:09:00.480 importing all these modules that we  
00:09:02.880 need. I've already saved my API keys in  
00:09:05.920 this  
00:09:06.839 .env file. So, we just need to load them  
00:09:09.680 instead of hard coding the API keys in  
00:09:12.680 the notebook. We also set the maximum  
00:09:14.600 number results to 10 which is how many  
00:09:17.640 search results we want per query. So,  
00:09:20.040 normally you will get Yeah, you you  
00:09:22.200 actually get 10  
00:09:24.280 articles for the first page of the  
00:09:26.440 Google search. But if you want to have  
00:09:28.800 only five or seven  
00:09:31.040 first articles, you can also specify it  
00:09:34.000 here. On the The hand, if you want to  
00:09:36.000 collect results from multiple pages from  
00:09:38.480 Google search, then you have to call the  
00:09:41.120 API multiple times. Next, I defined a  
00:09:44.000 function called collect search results  
00:09:46.320 that basically takes a query or list of  
00:09:49.160 queries. For example, how to make a  
00:09:51.160 cappuccino or in our case, AI copyright  
00:09:54.520 lawsuits. Then, we also take the number  
00:09:57.640 of results. So, I default it to the  
00:10:00.720 maximum number of results for each  
00:10:03.280 query. And then this function basically  
00:10:06.680 loop over all the queries and  
00:10:10.720 uh call the API with with with this  
00:10:14.200 basically with this uh lines of code.  
00:10:16.840 So, use the Google search module here  
00:10:19.400 and apply the parameters that we defined  
00:10:22.560 here. So, we defined the engine as  
00:10:25.120 Google, query is the query, Google  
00:10:28.080 domain is the google.com, and the  
00:10:31.440 language is English, etc. And finally,  
00:10:34.040 the API key that is our API key. So,  
00:10:38.320 here we get back the search results. And  
00:10:42.320 finally, I just um  
00:10:44.600 get back the dictionary. And then we  
00:10:46.520 just need to append the results for each  
00:10:48.720 query to the raw results variable. And  
00:10:52.520 really, the rest is just bookkeeping and  
00:10:55.280 just uh keeping all the results in in a  
00:10:58.360 certain format. In this case, this is um  
00:11:01.839 I turn it into a data frame. And in the  
00:11:04.720 end, remove the duplicated URLs. So, the  
00:11:07.240 same article, same website may appear in  
00:11:10.520 the search results for different  
00:11:11.880 queries. So, I want to avoid that. And  
00:11:14.600 so, I remove all the duplicates and  
00:11:17.400 return the data frame together with the  
00:11:20.680 raw results. And let's just run this.  
00:11:24.360 And here we actually run this function  
00:11:26.000 collect search results for these two  
00:11:28.520 queries, AI intellectual property and  
00:11:31.160 copyright generative AI. You can swap  
00:11:33.520 out these out for whatever topic you are  
00:11:35.840 researching. So, I'll just quickly run  
00:11:38.000 this and the output is basically a to-  
00:11:41.440 table with 10 articles collected. Oh,  
00:11:44.280 actually it's 20\. So, 10 articles each.  
00:11:47.120 And here I just want to give a quick  
00:11:49.840 peek at the full raw API response that  
00:11:53.120 we actually got. So, this is a list of  
00:11:55.760 the search results for these two  
00:11:58.320 different queries. So, this is useful  
00:12:00.640 for debugging and it's not really  
00:12:02.920 critical at all. So, I just know that  
00:12:04.720 this is the raw result that we actually  
00:12:06.840 got um to produce this table. Now, the  
00:12:09.880 next step is to actually scrape text  
00:12:12.720 from articles and videos that we got  
00:12:15.640 from the Google search results. So,  
00:12:18.280 based on all these different URLs for  
00:12:20.600 all these different articles and videos,  
00:12:22.840 we can actually scrape the text from  
00:12:25.080 them. So, the full article text and not  
00:12:27.960 only the short snippets here that show  
00:12:31.400 up on the Google search. So, these  
00:12:34.680 scrapers are really the core of this  
00:12:36.960 notebook. And here for the scraping of  
00:12:40.680 the  
00:12:41.720 articles, I'm using the Trafilatura  
00:12:45.520 library. Oh my god, this is such a  
00:12:47.280 difficult library name. And this module  
00:12:49.400 basically downloads a web page and  
00:12:51.640 strips away all the junk. For example,  
00:12:53.920 the navigation bars, the ads, the  
00:12:56.040 footers to give you just the article  
00:12:59.080 text. So, it's way better than trying to  
00:13:01.680 parse the HTML yourself with Beautiful  
00:13:04.520 Soup or whatever other library for web  
00:13:06.720 scraping. And then for the YouTube  
00:13:09.320 transcripts, I just extract all the  
00:13:11.400 video IDs from the URL with a regex. So,  
00:13:15.240 here is a regex that allows me to  
00:13:18.560 extract the video ID from an URL. And  
00:13:21.960 then the get transcript function  
00:13:23.920 basically take the  
00:13:27.560 video ID that we got and call the  
00:13:30.560 YouTube transcript API to get back the  
00:13:33.440 transcript. So, the whole thing is tied  
00:13:35.840 together in this in rich search results  
00:13:38.640 function. It takes the data frame that  
00:13:40.760 contains the information for the  
00:13:43.480 articles and for the videos and then add  
00:13:46.480 the full text column with the results.  
00:13:48.840 So, here if I just run it for you and  
00:13:53.600 let's see this in action. So, here we  
00:13:56.360 go. The output here is a data frame  
00:13:58.720 again with all the 20 articles and  
00:14:01.840 videos that we got from Google search,  
00:14:04.080 but the difference is now we have the  
00:14:06.360 full text column that contains the text  
00:14:09.800 or the transcript from articles and  
00:14:12.040 videos. So, note that I also have to  
00:14:15.000 removed some of the articles here that  
00:14:18.800 maybe some articles might be behave or  
00:14:21.360 they have bought protection or some  
00:14:23.280 videos just don't have captions. So, we  
00:14:25.240 only keep the results that have the  
00:14:27.320 status success. So, this gives us only  
00:14:30.320 the usable results. This is the final  
00:14:33.280 final output and we can take a look at  
00:14:36.400 this and finally I just save it into  
00:14:40.640 a CSV file called AI copyright data set.  
00:14:43.920 And the idea is we will use this full  
00:14:46.520 text the full text column all the text  
00:14:49.040 from the articles that we scraped to  
00:14:51.320 create the knowledge graph and build a  
00:14:53.280 graph rack pipeline on top of it. That  
00:14:55.440 is it for collecting real world data.  
00:14:57.760 The next step is to actually build the  
00:15:00.120 graph rack pipeline. All right, so, in  
00:15:02.000 this part I'm going to walk you through  
00:15:03.960 a full graph rack pipeline from scratch.  
00:15:06.440 And what we are building here is a  
00:15:08.000 knowledge graph on top of the data set  
00:15:10.440 that we just scraped with sub API about  
00:15:13.720 AI copyright and governance and then  
00:15:15.880 build a knowledge graph and detect  
00:15:17.920 communities within this graph and then  
00:15:20.880 generate community summaries and  
00:15:22.960 visualize this graph and finally query  
00:15:26.320 using graph rack. So, the key packages  
00:15:29.000 that we are going to need here is llama  
00:15:31.160 index, which is the framework we are  
00:15:33.040 building on. We also have grasp a logic.  
00:15:36.120 So, this is a library that gives us the  
00:15:39.400 Leiden algorithm for community  
00:15:41.080 detection. And for visualization, we're  
00:15:43.000 going to be using d3.js and not by this,  
00:15:46.000 sorry. So, going to remove this here.  
00:15:48.080 All right, so we go to import and  
00:15:50.120 configuration. So, basically import all  
00:15:52.440 the things that we need and also load  
00:15:56.160 the API keys for open AI because I'm  
00:15:59.160 going to use open AI models. So, we're  
00:16:01.440 going to need open AI API key over here.  
00:16:04.480 All right, moving on to configuration.  
00:16:07.080 We use two different models and this is  
00:16:09.600 simply for cost optimization. GPT-4o  
00:16:12.560 mini handles all the heavy lifting. So,  
00:16:15.240 the extraction and community  
00:16:17.240 summarization because that work is  
00:16:19.720 repetitive and high volume. You  
00:16:21.800 certainly don't need the smartest model  
00:16:23.680 for that, but for the final query  
00:16:26.080 synthesis, we switch to GPT-4o, which  
00:16:29.400 has better reasoning quality. And here  
00:16:32.080 larger model is better. So, the rest of  
00:16:35.120 this cell is basically it's pretty  
00:16:37.680 self-explanatory. So, we have the  
00:16:39.920 extraction LLM being GPT-4o mini. The  
00:16:43.760 query LLM is GPT-4o. We process up to 50  
00:16:48.839 articles and we extract up to 20 entity  
00:16:52.720 relationship entity triplets per chunk.  
00:16:55.360 Here I call it per chunk, but actually  
00:16:57.880 it's per article because I didn't  
00:17:00.680 actually split the articles into chunks  
00:17:03.640 because I found that the articles are  
00:17:05.240 not super long, so I just skip this  
00:17:08.599 chunking step. And we also run four  
00:17:11.160 parallel workers for the extraction to  
00:17:13.439 speed things up. All right, moving on to  
00:17:15.640 the next step, which is to define the  
00:17:17.800 ontology, and this is one of the most  
00:17:19.760 important steps that people often skip.  
00:17:22.640 The ontology, as I mentioned earlier, is  
00:17:24.720 the schema of our knowledge graph, and  
00:17:26.680 it tells the LLM exactly what types of  
00:17:29.640 entities and what types of relationships  
00:17:31.960 it's allowed to extract. So, it's  
00:17:34.360 really, really important. And for this  
00:17:36.280 particular use case about uh  
00:17:39.560 uh on the AI copyright and governance, I  
00:17:42.680 define below in this cell seven entity  
00:17:45.840 types and eight relationship types. Uh  
00:17:48.720 and here we just basically put it in a  
00:17:51.920 list like so. The entity types include  
00:17:54.680 the organization uh like companies or  
00:17:58.000 labs or in industry groups. And here we  
00:18:00.840 have the list of relationship types that  
00:18:03.640 we want to extract. So, for example,  
00:18:06.000 filed against or defendant in, for  
00:18:08.680 example, OpenAI is the defendant in The  
00:18:12.320 New York Times lawsuit. Uh or regulates  
00:18:15.800 or trained on or part of. So, one person  
00:18:18.880 can be part of an organization. So, how  
00:18:21.280 you define ontology really depends on  
00:18:23.880 your particular use case or your domain  
00:18:26.840 knowledge. And here is just a very basic  
00:18:29.080 example of how you might want to do  
00:18:30.640 that. So, let me run this cell. And so,  
00:18:33.720 here we have the entity types and  
00:18:35.200 relationship types printed out. The next  
00:18:37.440 step is the extraction prompt. In this  
00:18:40.240 step, we basically specify an uh a a  
00:18:44.520 prompt template. And this prompt  
00:18:46.640 template is going to take the allowed  
00:18:49.680 entity types and allowed relationship  
00:18:51.760 type that we defined in our ontology.  
00:18:54.880 And then, it specify the goal. Given a  
00:18:58.760 news article about AI copyright,  
00:19:02.040 governance, and intellectual property,  
00:19:04.640 identify all entities mentioned in the  
00:19:07.520 article and their relationships. Extract  
00:19:10.000 up to how many triplets or relationship  
00:19:13.240 energy triplets that um we have defined  
00:19:16.600 before, that is 20\. And um steps is  
00:19:21.280 first identify all entities. And for  
00:19:24.680 each entity extract these different  
00:19:27.160 fields. Firstly, name, uh the type, and  
00:19:31.280 the description. For example, OpenAI um  
00:19:34.720 being an organization and description.  
00:19:38.280 So, for example, this is a an AI  
00:19:40.440 provider. So on and so on. The second  
00:19:43.560 step is to identify relationships  
00:19:46.040 between those entities. And for each  
00:19:48.560 relationship, extract the source of the  
00:19:51.360 relationship, so the name of the source  
00:19:54.200 entity, and then the target entity, and  
00:19:57.280 the actual relationship. So, uh for  
00:20:00.360 example, it can be defendant in, so  
00:20:02.920 OpenAI is defendant in the New York  
00:20:05.800 Times lawsuit, and the description of  
00:20:08.760 this relationship. So, just one sentence  
00:20:11.600 explaining why and how these entities  
00:20:14.080 are related. And the reason why we want  
00:20:16.040 to get all these descriptions here for  
00:20:18.160 the entities and relationships is  
00:20:20.320 because that is going to provide extra  
00:20:23.080 contact um for us later when we generate  
00:20:26.360 the community summaries. It's going to  
00:20:28.080 enrich those summaries. And finally, we  
00:20:30.760 just pass in the real article text here  
00:20:33.560 for the extraction. Now, let's run this  
00:20:35.560 cell, and here is just a preview of this  
00:20:39.280 uh this prompt printed out. Now, in the  
00:20:41.520 next step, we have the Pydantic  
00:20:44.040 extraction models. So, instead of  
00:20:46.480 passing raw LLM text with regex, so  
00:20:50.320 for example, it gives an output like  
00:20:52.800 this, which is fragile and very annoying  
00:20:55.560 to pass. We define three models. The  
00:20:58.840 first one is extracted entity, which has  
00:21:02.520 the name, the type, and the description  
00:21:04.880 corresponding to the information we want  
00:21:07.000 to extract for each entity. And then we  
00:21:09.720 have the extracted relationship, which  
00:21:11.600 has source, target, relation, and  
00:21:13.880 description. And the third data model is  
00:21:16.360 the extraction result that basically  
00:21:18.360 wraps a list of extracted entity and a  
00:21:22.080 list of extracted relationship together  
00:21:24.880 in one data data object. All right, so  
00:21:28.760 let's run this one. And so we have these  
00:21:30.760 models defined. Now, the beautiful thing  
00:21:32.960 about using these Pydantic schemas is  
00:21:35.760 that later when we pass these schemas to  
00:21:38.360 Open AI as a function calling schema,  
00:21:41.240 the output that is returned from the LLM  
00:21:43.880 will be automatically validated and  
00:21:46.160 typed. We don't need to manually pass  
00:21:48.440 the outputs, which can be really, really  
00:21:50.560 annoying and messy. The structured  
00:21:52.440 output or the structured JSON that gets  
00:21:54.960 returned by the LLM will be  
00:21:57.000 automatically validated and typed. So,  
00:21:59.880 we don't need to manually pass those  
00:22:02.040 outputs and do some messy string  
00:22:04.160 manipulation ourselves, and which can be  
00:22:06.760 very, very annoying. Also, if the LLM  
00:22:09.120 tries to return, for example, an  
00:22:11.440 extracted entity that doesn't fit the  
00:22:14.040 schema, that output just gets  
00:22:15.840 automatically rejected. So, that is a  
00:22:18.120 huge benefit of using Pydantic for  
00:22:20.480 output validation. Next, we go to the  
00:22:23.680 graph rack extractor. So, this is  
00:22:26.160 really, really the core of the knowledge  
00:22:28.040 graph extraction engine. This is quite a  
00:22:30.080 big class and there's a bit of code in  
00:22:32.000 there. So, let me just explain this for  
00:22:34.840 you in a plain English. Here's what it  
00:22:38.240 does for each article. So, the first  
00:22:41.400 step it is to call the LLM and sends it  
00:22:45.120 to the LLM using a structured predict  
00:22:48.400 function here and together with our  
00:22:50.680 extraction results, the Pydantic schema  
00:22:53.400 that we defined in the last step. And  
00:22:55.440 then the result would be a validated  
00:22:57.920 extraction result with entities and  
00:23:00.680 relationships. And in step two, we are  
00:23:03.800 going to convert these extracted entity  
00:23:07.480 into um entity node object. And in step  
00:23:11.800 three, we also do the same for the  
00:23:14.520 relationship. Basically, taking all the  
00:23:17.120 relationships that we extracted and  
00:23:19.880 convert them into  
00:23:22.600 relation object. And the entity node and  
00:23:26.160 relation objects are basically just the  
00:23:29.800 way that LlamaIndex store data for  
00:23:33.040 entities and relationships. That's just  
00:23:34.960 the data model that they they use.  
00:23:37.320 And representing the entities and  
00:23:39.040 relationships that way makes our data  
00:23:41.760 compatible with uh LlamaIndex later. And  
00:23:45.360 in step seven, we define the graph rack  
00:23:48.160 store. So, this is where we convert our  
00:23:51.520 knowledge graph to a NetworkX graph.  
00:23:54.200 Then, we run the community detection  
00:23:56.080 algorithm called hierarchical Leiden to  
00:23:58.640 find entity clusters. And then, for each  
00:24:01.160 cluster, we collect all the entities and  
00:24:04.720 relationships and ask the LLM to write a  
00:24:08.560 summary for each of those clusters. So,  
00:24:12.000 it's like a writing a briefing note to  
00:24:14.360 present what this community is about.  
00:24:16.960 Just a quick note here, if you're not  
00:24:18.840 familiar with the concept of property  
00:24:20.960 graph, property graph is just a  
00:24:23.040 knowledge graph where relationships not  
00:24:25.800 only are connections between entities,  
00:24:28.240 but they also carry a name, which is a  
00:24:31.360 type of relationship, and some other  
00:24:33.840 properties. So, in this case, we might  
00:24:35.720 have description of the relationship or  
00:24:38.520 some other properties. All right, let's  
00:24:40.720 go ahead and define this class, and  
00:24:43.640 we'll see how how it works in a bit. And  
00:24:46.080 then, the the next step, we have the  
00:24:48.360 graph rack query engine, and this is  
00:24:51.000 where query actually gets answered. So,  
00:24:53.680 it used a two-step approach. The first  
00:24:56.520 step is per community answering. For  
00:24:59.080 each community summary, we ask a cheaper  
00:25:01.640 model, so here in this case GPT-4o mini,  
00:25:04.840 whether it can answer the question based  
00:25:07.680 on that summary. If the summary isn't  
00:25:10.400 relevant to the question, it will return  
00:25:13.080 no relevant information and we just skip  
00:25:15.520 it. And we just do this for all  
00:25:17.480 community summaries. This is smart  
00:25:19.600 because most communities won't be  
00:25:21.520 relevant to any given question and so we  
00:25:24.280 don't want to waste tokens on them. And  
00:25:27.520 in the step two, we take all the  
00:25:29.920 relevant partial answers based on all  
00:25:33.160 the different community summaries and  
00:25:35.840 send them to a stronger model. And in in  
00:25:38.720 this case is GPT-4o to synthesize into  
00:25:42.520 one final and clean response. So, this  
00:25:46.600 is the code for this GraphRAG query  
00:25:49.880 engine. And here you can see that we  
00:25:52.280 have two steps here. Step one is the get  
00:25:56.520 the partial answer from each community  
00:25:58.760 summary and step two is to aggregate  
00:26:02.280 those answers in one final answer. So,  
00:26:06.520 that is it for this GraphRAG query  
00:26:09.760 engine. Now that we've got all the  
00:26:11.720 configuration and all the necessary  
00:26:13.760 classes, we now will start loading our  
00:26:17.320 actual article data set  
00:26:20.040 that we've seen before and this is the  
00:26:22.760 article data set containing the full  
00:26:26.040 text for the articles and then we wrap  
00:26:30.480 articles as document. We have the  
00:26:32.440 article text goes in as the main content  
00:26:35.840 and we have the metadata here being  
00:26:38.960 containing the title, source, and date.  
00:26:41.760 So, no chunking is needed here because  
00:26:44.520 the articles are short enough to fit in  
00:26:47.640 the LLM's context window as is. So, I  
00:26:50.880 skip the chunking part. So, here is all  
00:26:53.920 the text in this fourth document in our  
00:26:58.400 notes list. So, here is the actual  
00:27:02.000 article text. And so, let's move on to  
00:27:05.920 building the knowledge graph. This is  
00:27:07.640 where it all comes together. We  
00:27:09.360 instantiate the graph rack extractor and  
00:27:12.960 the graph rack store. And then we will  
00:27:15.240 pass the graph rack extractor and the  
00:27:18.000 graph store into the llama index  
00:27:21.800 property graph index. The index here  
00:27:25.160 handles the full workflow automatically.  
00:27:28.040 It takes the document, so the nodes,  
00:27:30.880 passes it through our extractor, so the  
00:27:34.080 knowledge graph extractor, and the  
00:27:36.320 extractor calls the LLMs and gets back  
00:27:39.120 the structured entities and  
00:27:40.600 relationships and stores them in the  
00:27:43.120 graph store. So, this is where  
00:27:45.480 everything happens. And this is actually  
00:27:47.920 the most time-consuming step in the  
00:27:50.040 whole notebook. It's making LLM calls  
00:27:52.440 for every single article. So, let me  
00:27:55.480 quickly run this cell. All right, now  
00:27:58.520 this is running and we are building the  
00:28:00.560 knowledge graph from all the documents  
00:28:02.600 that we have. This may take a few  
00:28:04.360 minutes, so let me just speed this up.  
00:28:06.640 All right, we've just finished building  
00:28:08.640 the knowledge graph. So, let's print out  
00:28:12.240 an example article. Here is an example  
00:28:14.920 article together with all the extracted  
00:28:18.480 entities and relationships that that  
00:28:21.040 were identified from this article only.  
00:28:23.800 So, one organization is Darrow Everett  
00:28:27.280 LLP, the government, the US Copyright  
00:28:30.480 Office, AI system, Creative the Machine,  
00:28:34.400 AI system ChatGPT,  
00:28:36.800 um AI system Midjourney, and so on. And  
00:28:40.160 then we have the relationships. They are  
00:28:42.960 um  
00:28:43.640 the US Copyright Office references um  
00:28:47.600 Creative the Machine um and regulate  
00:28:50.440 copyright act, so on and so on. So,  
00:28:53.200 these are all the relationships among  
00:28:55.520 all these different entities. It's a  
00:28:57.800 nice sanity check to make sure that the  
00:29:00.160 extraction is working properly. And you  
00:29:02.520 can also print out all the unique  
00:29:05.560 entities that were identified just to be  
00:29:08.560 sure that we don't have any weird stuff  
00:29:11.120 going on over here. So, for each  
00:29:13.440 different type of entities,  
00:29:16.240 we have these different things. Some of  
00:29:19.320 the entities were not extracted  
00:29:21.360 properly, so it falls back to just call  
00:29:24.360 it entity. And for example, here 10,000  
00:29:27.400 responsive comments, generative AI  
00:29:29.760 copyright disclosure act. I'm not sure  
00:29:32.760 why it was not categorized properly, but  
00:29:35.320 these really didn't happen very often,  
00:29:37.160 so I didn't bother. The rest of the  
00:29:39.680 entities look pretty okay to me, so I  
00:29:42.800 just go on with the next step. In step  
00:29:45.320 12, we start building the communities  
00:29:47.680 and generate summaries for them. And  
00:29:49.960 this line basically runs the Leiden  
00:29:52.800 community detection, clusters the  
00:29:55.040 entities, and then we generate the  
00:29:57.840 summaries for each cluster. Let's run  
00:30:01.520 this cell, and I'm also printing out all  
00:30:04.480 the summaries from the communities as  
00:30:06.960 well. So, here you can see community  
00:30:08.920 zero. This cluster encompasses key  
00:30:12.120 entities and concepts related to AI  
00:30:14.080 copyright and governance, including blah  
00:30:16.720 blah blah. Community one, on the other  
00:30:18.800 hand, centers around the European AI  
00:30:21.760 EU's AI Act, so on and so on. Cool. Once  
00:30:25.000 that's done, we move on to the next  
00:30:27.840 step, which is really fun. That is about  
00:30:30.480 visualizing the knowledge graph that  
00:30:32.560 we've got. Here I'm using d3.js, and we  
00:30:36.560 basically this cell basically exports  
00:30:38.960 the graph that we have to a JSON file  
00:30:41.880 called graph data.json. I've already run  
00:30:44.320 this, so that's why you see it here. And  
00:30:46.680 then we inject it into a D3.js  
00:30:50.320 HTML template. So, this is the graph  
00:30:53.000 template. Claude did this for me, and  
00:30:56.040 it's really nice now that AI can do a  
00:30:58.680 pretty decent job at this. Now, the  
00:31:00.760 visualization has been saved to the AI  
00:31:03.800 copyright graph.html  
00:31:06.560 file. So, let me quickly go live here  
00:31:09.920 and show you what it does. And here is  
00:31:14.200 the visualization.  
00:31:16.240 This is HTML file. This is network  
00:31:18.560 graph. Looks pretty cool, right? And you  
00:31:21.120 can see that we have different entity  
00:31:23.000 types that are coded in different  
00:31:25.520 colors. I've also instructed Claude to  
00:31:28.680 make the size of the nodes correspond to  
00:31:31.200 the number of connections that it has.  
00:31:33.680 So, for example here, we can see that we  
00:31:36.360 have OpenAI here. And if we click on  
00:31:39.560 here, see that these are the different  
00:31:42.400 connections that it has.  
00:31:44.520 OpenAI has one legal case that is  
00:31:48.240 connected to New York The New York  
00:31:50.280 Times. It's good to note that the  
00:31:51.960 visualization itself is not essential  
00:31:54.440 for the GraphRAG to work, but it's great  
00:31:56.760 for presentations and for understanding  
00:31:59.280 what your graph actually looks like.  
00:32:01.120 Finally, we get to query the system.  
00:32:03.880 This is really the end goal that we want  
00:32:06.360 to reach. Here we create a query engine  
00:32:09.960 that contains the graph store and the  
00:32:13.040 query LLM, which is GPT-4o, for final  
00:32:15.960 synthesis. So, let's define this query  
00:32:19.000 engine, and then we can start asking  
00:32:21.440 question to this query engine. The first  
00:32:23.680 question I want to test is a big picture  
00:32:26.280 kind of thematic question. What are the  
00:32:28.840 main legal arguments being made around  
00:32:31.400 AI copyright and training data? So,  
00:32:34.800 let's run this one. We pass this query  
00:32:37.560 to the query engine and basically call  
00:32:41.040 this custom query method and just wait  
00:32:44.720 and see what comes back. And in this  
00:32:46.560 question, no single article has the full  
00:32:49.360 answer. Standard rack pipeline will  
00:32:51.400 struggle here, but GraphRacks  
00:32:53.480 synthesizes across multiple communities  
00:32:56.800 and it should be able to give a more  
00:32:58.720 comprehensive answer. All right, here's  
00:33:00.840 the answer. The main legal arguments  
00:33:02.960 around AI copyright and training data  
00:33:05.400 focus on several key issues. Authorship  
00:33:08.520 and ownership, use of training data,  
00:33:11.240 fair use doctrine, regulatory  
00:33:13.360 frameworks, legal reform, economic and  
00:33:16.480 ethical implications. So, these are five  
00:33:19.160 main arguments. So, it's pretty cool.  
00:33:21.800 And moving on to the next test I want to  
00:33:25.040 do that is a question that concerning  
00:33:28.520 cross-entity relationships. For example,  
00:33:31.560 which companies are involved in AI  
00:33:33.560 copyright and governance disputes and  
00:33:36.520 what are their positions? The answer  
00:33:38.320 comes back with several companies  
00:33:40.040 involved in disputes. Stability against  
00:33:43.760 artists and lawsuits from Getty Images,  
00:33:46.960 Midjourney against Darrow Everett LLP,  
00:33:51.240 and OpenAI facing and Microsoft facing  
00:33:54.920 copyright infringement lawsuit from The  
00:33:57.040 New York Times and so on and so on. So,  
00:33:59.680 this is an example of cross-entity  
00:34:02.360 relationships. Traditional rack pipeline  
00:34:04.880 would really struggle to give a complete  
00:34:06.920 answer. Question number three is about  
00:34:09.080 comparative policy question. For  
00:34:11.399 example, how different governments are  
00:34:13.879 approaching AI governance? And the  
00:34:16.159 answer is, \&quot;I don't have enough  
00:34:18.000 information in the knowledge graph to  
00:34:19.639 answer that question.\&quot; This actually  
00:34:21.679 surprised me, but I'm guessing that most  
00:34:24.639 articles are about the US and not about  
00:34:27.679 other governments like EU or the UK. So,  
00:34:31.520 probably there's really not enough  
00:34:33.399 information for comparison. So, that's  
00:34:35.800 the full pipeline and to recap, we  
00:34:38.080 define an anthology to keep things  
00:34:40.080 consistent, we build a custom ex- a  
00:34:42.840 graph rack extractor to extract entities  
00:34:45.320 and relationships alongside their  
00:34:47.280 descriptions, and then we run the  
00:34:50.000 community detection algorithm on the  
00:34:51.918 graph and generate summaries using an  
00:34:55.080 LLM, and then we visualize the graph and  
00:34:57.880 build a query engine that reasons over  
00:35:00.800 those community summaries. While  
00:35:02.960 building this project, I noticed a  
00:35:04.800 couple of different things that didn't  
00:35:06.640 go quite well. For example, some  
00:35:08.760 entities come back with slightly  
00:35:11.000 different names. For example, the US  
00:35:13.440 Copyright Office versus Copyright  
00:35:15.800 Office. So, a lot of those entities can  
00:35:18.080 be deduplicated and normalized to make  
00:35:21.560 it more consistent and more useful. And  
00:35:24.280 there you have it, a full working graph  
00:35:26.240 rack system built on live data you  
00:35:28.360 script yourself reasoning over one of  
00:35:30.560 the most complex and opaque topics right  
00:35:33.320 now in tech. You can find the full code  
00:35:35.200 in the link in description along with  
00:35:37.000 SOAP API if you want to try this on your  
00:35:39.280 own research topic. You can also scan  
00:35:41.480 the QR here to get the link.

