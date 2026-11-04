set(TARGET_NAME sim)

add_library(${TARGET_NAME} STATIC
	src/sim.cpp
)

target_link_libraries(${TARGET_NAME} PUBLIC core)

target_include_directories(${TARGET_NAME} PUBLIC
	${CMAKE_CURRENT_SOURCE_DIR}/include
)

get_filename_component(SIM_ASSET_DIR
	"${CMAKE_CURRENT_SOURCE_DIR}/../../frontend/public/assets/models" ABSOLUTE)

if(NOT EXISTS "${SIM_ASSET_DIR}/stadium_col.glb")
	message(WARNING "sim: stadium meshes not found in ${SIM_ASSET_DIR}")
endif()

target_compile_definitions(${TARGET_NAME} PRIVATE
	SIM_DEFAULT_ASSET_DIR=\"${SIM_ASSET_DIR}\"
)

target_compile_options(${TARGET_NAME} PRIVATE
	-Wall -Wextra -Werror -pedantic
	-Wno-deprecated-literal-operator -Wno-unused-template
)

find_package(Python3 COMPONENTS Interpreter Development.Module QUIET)

if(Python3_FOUND)
	execute_process(
		COMMAND "${Python3_EXECUTABLE}" -m pybind11 --cmakedir
		OUTPUT_VARIABLE PYBIND11_CMAKE_DIR
		OUTPUT_STRIP_TRAILING_WHITESPACE
		ERROR_QUIET
	)
endif()

find_package(pybind11 CONFIG QUIET HINTS "${PYBIND11_CMAKE_DIR}")

if(pybind11_FOUND)
	pybind11_add_module(transcendence_sim src/bindings.cpp)
	target_link_libraries(transcendence_sim PRIVATE ${TARGET_NAME})

	# Land beside the Python wrapper that imports it.
	set_target_properties(transcendence_sim PROPERTIES
		LIBRARY_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/python"
	)

	message(STATUS "pybind11 found - building the transcendence_sim Python module")
else()
	message(STATUS "pybind11 not found - skipping the Python module")
endif()
