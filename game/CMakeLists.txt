cmake_minimum_required(VERSION 3.20)
project(Game)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(NOT EMSCRIPTEN)
	# core and sim get linked into a shared Python module, which needs
	# position-independent code throughout.
	set(CMAKE_POSITION_INDEPENDENT_CODE ON)
endif()

add_subdirectory(core)

option(BUILD_SERVER "Build the game server" OFF)

if(EMSCRIPTEN)
	add_subdirectory(client)
else()
	if(BUILD_SERVER)
		add_subdirectory(server)
	endif()
	add_subdirectory(sim)
endif()

# add_subdirectory(ai)
